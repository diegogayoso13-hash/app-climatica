// Robot "comparar_marea" (prueba de 4 semanas, cada hora a los :50).
// Guarda el pronostico oficial del SHN, las alturas medidas que publica el SHN y lo que responda PronUy,
// y los compara contra lo real de la CARP. No se muestra en la app: solo un resumen en "Estado del robot".
// A las 4 semanas se apaga solo (borra su propio cron). Los datos quedan guardados.
import postgres from "npm:postgres@3.4.5";
import { leerPronostico, leerAlturas } from "./shn.ts";
import { desfaseNorden, comparar, ultimaVersion, type Punto } from "./comparar.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const UA = "Mozilla/5.0 (app-climatica)";
const FUENTE = "comparar_marea", CRON = "comparar-marea-cada-hora", DIAS = 28;
const URL_PRON = "https://www.hidro.gov.ar/oceanografia/pronostico.asp";
const URL_ALT = "https://www.hidro.gov.ar/oceanografia/AlturasHorarias.asp?export=csv";
const URL_PRONUY = "https://webstatic-backend.fing.edu.uy/imfia/pronostico-marea/";
const FALLA = "https://no-responde.invalid/"; // solo para las pruebas

async function traer(url: string, ms = 30000) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) { await r.body?.cancel(); throw new Error(`HTTP ${r.status}`); }
    return r;
  } catch (e) { throw new Error(e instanceof Error && e.message.startsWith("HTTP") ? e.message : `no responde (${e instanceof Error ? e.name : "sin conexión"})`); }
}
async function huella(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function registrar(ok: boolean, detalle: unknown, error?: string) {
  if (ok) await sql`insert into public.estado_fuentes (fuente, ultimo_ok, detalle) values (${FUENTE}, now(), ${sql.json(detalle as any)})
      on conflict (fuente) do update set ultimo_ok = now(), detalle = excluded.detalle`;
  else await sql`insert into public.estado_fuentes (fuente, ultimo_error, mensaje_error) values (${FUENTE}, now(), ${error ?? ""})
      on conflict (fuente) do update set ultimo_error = now(), mensaje_error = excluded.mensaje_error`;
}

// ---------- 1. SHN ----------
async function guardarShn(falla: boolean) {
  const errores: string[] = [], res: Record<string, unknown> = {};
  try {
    const p = leerPronostico(await (await traer(falla ? FALLA : URL_PRON)).text());
    await sql`insert into public.shn_emisiones ${sql({ desde: p.desde, hasta: p.hasta, fecha_texto: p.fecha, correccion_interior: p.correccionInterior, correccion_exterior: p.correccionExterior })}
      on conflict (desde) do nothing`;
    await sql`insert into public.shn_pronostico ${sql(p.filas.map((f) => ({ emision: p.desde, lugar: f.lugar, lugar_texto: f.lugarTexto, estado: f.estado, hora: f.hora, altura_m: f.altura_m, dudosa: f.dudosa, motivo: f.motivo })))}
      on conflict do nothing`;
    res.emision = p.desde; res.filas = p.filas.length; res.dudosas = p.filas.filter((f) => f.dudosa).length;
  } catch (e) { errores.push(`pronóstico SHN: ${e instanceof Error ? e.message : e}`); }
  try {
    const r = await traer(falla ? FALLA : URL_ALT);
    const a = leerAlturas(new TextDecoder("windows-1252").decode(await r.arrayBuffer()));
    for (let i = 0; i < a.length; i += 500)
      await sql`insert into public.shn_alturas ${sql(a.slice(i, i + 500))} on conflict (estacion, ts) do update set altura_m = excluded.altura_m`;
    res.alturas = a.length;
  } catch (e) { errores.push(`alturas SHN: ${e instanceof Error ? e.message : e}`); }
  return { res, errores };
}

// ---------- 2. PronUy (si no responde, solo se anota: no pone el robot en rojo) ----------
async function guardarPronuy(falla: boolean, antes: any) {
  try {
    const r = await traer(falla ? FALLA : URL_PRONUY, 20000);
    const tipo = r.headers.get("content-type"), texto = (await r.text()).slice(0, 2_000_000);
    const h = await huella(texto);
    const nuevo = await sql`insert into public.pronuy_crudo ${sql({ url: URL_PRONUY, tipo, huella: h, contenido: texto })} on conflict (huella) do nothing returning 1`;
    const [{ n }] = await sql`select count(*)::int as n from public.pronuy_crudo`;
    return { estado: "responde", desde: antes?.estado === "responde" ? antes.desde : new Date().toISOString(), guardadas: n, nueva: nuevo.length > 0 };
  } catch (e) {
    const [{ n }] = await sql`select count(*)::int as n from public.pronuy_crudo`;
    return { estado: "sin conexión", desde: antes?.estado === "sin conexión" ? antes.desde : new Date().toISOString(), guardadas: n, motivo: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- 3. Comparaciones ----------
const serie = (filas: { t: string; v: number | string }[]): Punto[] => filas.map((f) => ({ t: Number(f.t), v: Number(f.v) }));
async function resumen(desde: Date) {
  const alt = async (est: string, d = desde) => serie(await sql`select (extract(epoch from ts) * 1000)::bigint as t, altura_m as v from public.shn_alturas where estacion = ${est} and ts >= ${d} order by ts`);
  const carp = async (est: string, d = desde) => serie(await sql`select (extract(epoch from ts) * 1000)::bigint as t, marea_m as v from public.lecturas where estacion = ${est} and marea_m is not null and ts >= ${d} order by ts`);
  // El cero de Norden (A) mira tambien los 10 dias anteriores que guarda el SHN, para no perder saltos previos al inicio.
  const desdeA = new Date(desde.getTime() - 10 * 864e5);
  const [shnNorden, shnSF, shnBA, carpNorden, carpColonia] = await Promise.all([alt("norden", desdeA), alt("san_fernando"), alt("buenos_aires"), carp("norden", desdeA), carp("colonia")]);
  const filas = await sql`select p.lugar, p.estado, p.hora::text as hora, p.altura_m, p.emision::text as emision, p.dudosa from public.shn_pronostico p where p.hora >= ${desde}`;
  const ext = ultimaVersion(filas.map((f) => ({ lugar: f.lugar, estado: f.estado, hora: new Date(f.hora).toISOString(), altura_m: Number(f.altura_m), emision: new Date(f.emision).toISOString(), dudosa: f.dudosa })));
  const de = (l: string) => ext.filter((e) => e.lugar === l);
  const A = desfaseNorden(shnNorden, carpNorden);
  return {
    A: { ...A, saltos: A.saltos.slice(-5).map((s) => ({ ...s, t: new Date(s.t).toISOString() })) },
    B: { san_fernando: comparar(de("san_fernando"), shnSF, 3, 5), buenos_aires: comparar(de("buenos_aires"), shnBA, 3, 5) },
    C: {
      san_fernando_norden: comparar(de("san_fernando"), carpNorden, 4, 40), san_fernando_colonia: comparar(de("san_fernando"), carpColonia, 4, 40),
      buenos_aires_norden: comparar(de("buenos_aires"), carpNorden, 4, 40), buenos_aires_colonia: comparar(de("buenos_aires"), carpColonia, 4, 40),
    },
    extremos_pronosticados: ext.length, emisiones: (await sql`select count(*)::int as n from public.shn_emisiones where desde >= ${desde}`)[0].n,
  };
}

Deno.serve(async (req) => {
  const [s] = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'token_robot'`;
  if (!s || req.headers.get("x-token-robot") !== s.decrypted_secret) return new Response("no autorizado", { status: 401 });
  const q = new URL(req.url).searchParams;
  const prueba = q.get("prueba") === "1"; // prueba: no toca "Estado del robot" ni el cron
  const [cfgFila] = await sql`select valor from public.configuracion where clave = 'comparar_marea'`;
  const cfg = cfgFila?.valor as { inicio: string; fin: string } | undefined;
  const [ant] = await sql`select detalle from public.estado_fuentes where fuente = ${FUENTE}`;
  const ahora = new Date();

  // Pasaron las 4 semanas: se apaga solo. Los datos quedan.
  if (cfg && !prueba && ahora > new Date(cfg.fin)) {
    try { await sql`select cron.unschedule(${CRON})`; } catch { /* ya estaba apagado */ }
    const d = { ...(ant?.detalle ?? {}), terminado: true, terminado_en: ahora.toISOString() };
    await registrar(true, d);
    return new Response(JSON.stringify(d, null, 1), { headers: { "Content-Type": "application/json" } });
  }

  const shn = await guardarShn(q.get("probar_falla") === "shn");
  const pronuy = await guardarPronuy(q.get("probar_falla") === "pronuy", ant?.detalle?.pronuy);
  const desde = cfg ? new Date(cfg.inicio) : new Date(ahora.getTime() - 10 * 864e5);
  const r = await resumen(desde);
  const dia = cfg ? Math.min(DIAS, Math.floor((ahora.getTime() - Date.parse(cfg.inicio)) / 864e5) + 1) : null;
  const detalle = { modo: prueba ? "prueba" : "activo", dia, de: DIAS, inicio: cfg?.inicio ?? null, fin: cfg?.fin ?? null,
    shn: { ...shn.res, leido: shn.errores.length ? null : ahora.toISOString(), errores: shn.errores }, pronuy, ...r };
  if (!prueba) {
    if (shn.errores.length) await registrar(false, null, shn.errores.join(" | ") + " — se sigue con lo ya guardado");
    else await registrar(true, detalle);
  }
  return new Response(JSON.stringify(detalle, null, 1), { status: shn.errores.length ? 500 : 200, headers: { "Content-Type": "application/json" } });
});
