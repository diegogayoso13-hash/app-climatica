// Funcion "avisos". Dos usos:
//  1. ROBOT (con el token del robot, cada 5 min): revisa las condiciones y manda los avisos a cada celular anotado.
//     Con { "prueba": true, "datos": ... } usa datos inventados y solo les manda a los celulares de PRUEBA.
//  2. VENTANILLA (desde la app, sin token): anotar, actualizar, dar de baja y probar un celular. Todo se controla
//     (validar.ts), con limite de llamadas por minuto. Las tablas de avisos no se abren al publico.
// La clave secreta para firmar los avisos se crea sola la primera vez y queda en el Vault de Supabase (nunca en el codigo).
import postgres from "npm:postgres@3.4.5";
import { enviarPush, b64u } from "./webpush.ts";
import { validarPedido, TIPOS, type Prefs, type Tipo } from "./validar.ts";
import { evaluar, type Datos, type Estado } from "./evaluar.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const SUJETO = "https://diegogayoso13-hash.github.io/app-climatica/";
const LIMITE_POR_MINUTO = 12, MAX_CUERPO = 4096;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info" };
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");

// ---------- claves VAPID (en el Vault) ----------
let CLAVES: { publica: string; privada: string; sujeto: string } | null = null;
async function claves() {
  if (CLAVES) return CLAVES;
  const leer = async () => Object.fromEntries((await sql`select name, decrypted_secret from vault.decrypted_secrets where name in ('vapid_publica', 'vapid_privada')`).map((r) => [r.name, r.decrypted_secret]));
  let k = await leer();
  if (!k.vapid_publica || !k.vapid_privada) {
    const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const d = (await crypto.subtle.exportKey("jwk", par.privateKey)).d!, pub = b64u.enc(new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey)));
    try {
      await sql`select vault.create_secret(${d}, 'vapid_privada', 'Clave privada para firmar los avisos (web push). No compartir.')`;
      await sql`select vault.create_secret(${pub}, 'vapid_publica', 'Clave publica de los avisos (va en la app).')`;
    } catch { /* otra ejecucion la creo al mismo tiempo: se lee la que quedo */ }
    k = await leer();
  }
  return (CLAVES = { publica: k.vapid_publica, privada: k.vapid_privada, sujeto: SUJETO });
}

// ---------- registrar en "Estado del robot" ----------
async function registrar(ok: boolean, detalle: unknown, error?: string) {
  if (ok) await sql`insert into public.estado_fuentes (fuente, ultimo_ok, detalle) values ('avisos', now(), ${sql.json(detalle as any)})
      on conflict (fuente) do update set ultimo_ok = now(), detalle = excluded.detalle`;
  else await sql`insert into public.estado_fuentes (fuente, ultimo_error, mensaje_error) values ('avisos', now(), ${error ?? ""})
      on conflict (fuente) do update set ultimo_error = now(), mensaje_error = excluded.mensaje_error`;
}

// ---------- datos reales para evaluar ----------
const SEV: Record<string, string> = { Minor: "menor", Moderate: "moderada", Severe: "severa", Extreme: "extrema" };
async function datosReales(ahora: number): Promise<Datos> {
  const ult = await sql`select estacion, tipo, ts, marea_m, viento_kn, rafaga_kn from public.ultimas_lecturas order by ts desc`;
  const marea: Record<string, { v: number; ts: number } | null> = {};
  for (const e of ["norden", "colonia", "conchillas", "carmelo"]) { const l = ult.find((r) => r.estacion === e && r.tipo === "marea"); marea[e] = l ? { v: Number(l.marea_m), ts: new Date(l.ts).getTime() } : null; }
  const w = ult.find((r) => r.estacion === "norden" && r.tipo === "viento");
  const tramos = (await sql`select nombre, profundidad_m, estacion_1, estacion_2 from public.tramos_canal order by orden`).map((t) => ({ nombre: t.nombre, prof: Number(t.profundidad_m), e1: t.estacion_1, e2: t.estacion_2 }));
  const alertas = (await sql`select archivo, identificador, evento, severidad, toca_norden, toca_martin_garcia, hasta from public.alertas_smn where toca_zona and hasta > now()`).map((a) => ({
    clave: a.identificador ?? a.archivo, evento: a.evento ?? "Alerta", severidad: SEV[a.severidad] ?? a.severidad ?? "", donde: [a.toca_norden && "Norden", a.toca_martin_garcia && "Martín García"].filter(Boolean).join(" y "), hasta: new Date(a.hasta).getTime() }));
  const nov = await sql`select id, tipo, clave, descripcion, estado, km, vigente_hasta, primera_vez from public.novedades_canal where normalizada_en is null`;
  const novedades = nov.filter((n) => n.tipo === "baliza" || (n.tipo === "radioaviso" && (!n.vigente_hasta || new Date(n.vigente_hasta).getTime() > ahora))).map((n) => ({
    clave: `${n.id}|${new Date(n.primera_vez).toISOString()}`,
    texto: n.tipo === "radioaviso" ? `Radioaviso AVUR ${n.clave}: ${String(n.descripcion ?? "").replace(/^CANALES A MARTIN GARCIA · /, "").toLowerCase()}`
      : `Nº ${n.clave} ${String(n.descripcion ?? "").replace(/\s*KM\s*[\d.,]+/i, "").toLowerCase()} ${n.estado}${n.km != null ? ` (km ${String(n.km).replace(".", ",")})` : ""}` }));
  const visF = await sql`select hora, min(visibilidad_m) as v from public.visibilidad_actual group by hora order by hora`;
  return { ahora, marea, viento: w ? { v: Number(w.viento_kn), g: w.rafaga_kn == null ? null : Number(w.rafaga_kn), ts: new Date(w.ts).getTime() } : null,
    tramos, alertas, novedades, vis: visF.map((r) => ({ t: new Date(r.hora).getTime(), v: Number(r.v) })) };
}

// ---------- robot ----------
async function robot(prueba: boolean, datosPrueba: Datos | null) {
  const ahora = datosPrueba?.ahora ?? Date.now();
  const d = datosPrueba ?? await datosReales(ahora);
  const cel = await sql`select id, endpoint, p256dh, auth, prefs from public.avisos_celulares where prueba = ${prueba}`;
  const ids = cel.map((c) => c.id);
  const est = ids.length ? await sql`select celular_id, tipo, activo, ultimo from public.avisos_estado where celular_id in ${sql(ids)}` : [];
  const env = ids.length ? await sql`select celular_id, tipo, clave from public.avisos_enviados where celular_id in ${sql(ids)}` : [];
  const k = await claves();
  let enviados = 0, bajas = 0, fallas = 0;
  const detalle: { celular: string; tipo: Tipo; ok: boolean }[] = [];
  for (const c of cel) {
    const estado: Partial<Record<Tipo, Estado | null>> = {};
    for (const e of est.filter((e) => e.celular_id === c.id)) estado[e.tipo as Tipo] = { activo: e.activo, ultimo: e.ultimo ? new Date(e.ultimo).getTime() : null };
    const ya = new Set(env.filter((e) => e.celular_id === c.id).map((e) => `${e.tipo}|${e.clave}`));
    const r = evaluar(d, c.prefs as Prefs, estado, ya);
    let dadoDeBaja = false;
    for (const m of r.mensajes) {
      try {
        const res = await enviarPush(c, { titulo: m.titulo, cuerpo: m.cuerpo, ir: m.ir, tipo: m.tipo }, k, m.ttl);
        detalle.push({ celular: c.id.slice(0, 8), tipo: m.tipo, ok: res.ok });
        if (res.baja) { dadoDeBaja = true; break; }
        if (res.ok) enviados++; else fallas++;
      } catch { fallas++; }
    }
    if (dadoDeBaja) { await sql`delete from public.avisos_celulares where id = ${c.id}`; bajas++; continue; }
    await sql.begin(async (tx) => {
      for (const m of r.marcar) await tx`insert into public.avisos_enviados (celular_id, tipo, clave) values (${c.id}, ${m.tipo}, ${m.clave}) on conflict do nothing`;
      for (const t of TIPOS) {
        if (!(t in r.estado)) continue;
        const s = r.estado[t];
        if (s === null) await tx`delete from public.avisos_estado where celular_id = ${c.id} and tipo = ${t}`;
        else if (s) await tx`insert into public.avisos_estado (celular_id, tipo, activo, ultimo) values (${c.id}, ${t}, ${s.activo}, ${s.ultimo ? new Date(s.ultimo) : null})
          on conflict (celular_id, tipo) do update set activo = excluded.activo, ultimo = excluded.ultimo`;
      }
      if (r.mensajes.length) await tx`update public.avisos_celulares set ultimo_envio = now(), fallas = 0 where id = ${c.id}`;
    });
  }
  return { modo: prueba ? "prueba" : "real", celulares: cel.length, enviados, bajas, fallas, detalle: prueba ? detalle : undefined };
}

// ---------- ventanilla ----------
async function ventanilla(req: Request) {
  const texto = await req.text();
  if (texto.length > MAX_CUERPO) return json({ error: "pedido demasiado grande" }, 413);
  // Limite por conexion y por minuto (la direccion se guarda "picada", nunca tal cual)
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sin-ip";
  const quien = await sha("tufaro|" + ip);
  const [{ n }] = await sql`insert into public.avisos_llamadas (quien, minuto) values (${quien}, date_trunc('minute', now()))
    on conflict (quien, minuto) do update set n = avisos_llamadas.n + 1 returning n`;
  if (n > LIMITE_POR_MINUTO) return json({ error: "demasiados pedidos: probá en un minuto" }, 429);
  let x: any; try { x = JSON.parse(texto); } catch { return json({ error: "pedido inválido" }, 400); }
  if (x?.accion === "clave" && Object.keys(x).length === 1) return json({ publica: (await claves()).publica });
  const v = validarPedido(x);
  if ("error" in v) return json({ error: v.error }, 400);
  const p = v.pedido;
  if (p.accion === "alta") {
    const llave = b64u.enc(crypto.getRandomValues(new Uint8Array(32)));
    const [c] = await sql`insert into public.avisos_celulares (endpoint, p256dh, auth, llave_hash, prefs, prueba)
      values (${p.endpoint}, ${p.p256dh}, ${p.auth}, ${await sha(llave)}, ${sql.json(p.prefs)}, ${p.prueba === true})
      on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, llave_hash = excluded.llave_hash, prefs = excluded.prefs,
        prueba = excluded.prueba, actualizado_en = now(), fallas = 0 returning id`;
    await sql`delete from public.avisos_estado where celular_id = ${c.id}`; // arranca de cero (lo vigente no se avisa)
    return json({ ok: true, llave });
  }
  const [c] = await sql`select id, endpoint, p256dh, auth, llave_hash from public.avisos_celulares where endpoint = ${p.endpoint}`;
  if (!c || c.llave_hash !== await sha(p.llave)) return json({ error: "celular no anotado o llave incorrecta" }, 403);
  if (p.accion === "actualizar") {
    await sql`update public.avisos_celulares set prefs = ${sql.json(p.prefs)}, actualizado_en = now() where id = ${c.id}`;
    return json({ ok: true });
  }
  if (p.accion === "baja") { await sql`delete from public.avisos_celulares where id = ${c.id}`; return json({ ok: true }); }
  // probar
  const r = await enviarPush(c, { titulo: "Tu Faro · Aviso de prueba", cuerpo: "Si ves esto, los avisos llegan a este celular.", ir: "ajustes", tipo: "prueba" }, await claves(), 600);
  if (r.baja) { await sql`delete from public.avisos_celulares where id = ${c.id}`; return json({ error: "este celular ya no recibe avisos: activalos de nuevo" }, 410); }
  return r.ok ? json({ ok: true }) : json({ error: `el servicio de avisos respondió ${r.estado}` }, 502);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
  const token = req.headers.get("x-token-robot");
  if (token) {
    const [s] = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'token_robot'`;
    if (!s || token !== s.decrypted_secret) return json({ error: "no autorizado" }, 401);
    let cuerpo: any = {}; try { cuerpo = await req.json(); } catch { /* sin cuerpo */ }
    const prueba = cuerpo?.prueba === true;
    try {
      const r = await robot(prueba, prueba ? cuerpo.datos ?? null : null);
      if (!prueba) await registrar(true, r);
      return json(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!prueba) await registrar(false, null, msg);
      return json({ error: msg }, 500);
    }
  }
  try { return await ventanilla(req); } catch (e) { return json({ error: "error interno" }, 500); }
});
