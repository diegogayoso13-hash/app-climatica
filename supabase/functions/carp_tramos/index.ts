// Robot "carp_tramos": una vez por semana lee la tabla "Anchos navegables" de la CARP
// y la compara con public.tramos_canal. Si cambio profundidad, ancho o fecha del relevamiento,
// actualiza y marca cambio_carp_en (la app muestra el aviso).
// Si no puede leer la pagina, o los nombres/km de los tramos no coinciden: NO toca nada
// y deja el error en estado_fuentes ("Estado del robot").
// Nunca toca km_mira ni las estaciones (esos los carga Diego).
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const UA = "Mozilla/5.0 (app-climatica)";
// La CARP por https solo acepta cifrados viejos: se usa http, igual que el robot "recolectar".
const PAGINA = "http://www.comisionriodelaplata.org/servicios_main.php?sid=AN";
// Solo para la prueba: una direccion que no existe, para ver que la tabla no se borra.
const PAGINA_FALLA = "http://carp-no-responde.invalid/servicios_main.php?sid=AN";

const num = (s: string) => {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

type TramoCarp = { nombre: string; desde: number; hasta: number; ancho: number; prof: number };

function leerTabla(html: string) {
  const texto = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ");
  const ini = texto.search(/Anchos Navegables Canal Mart/i);
  if (ini < 0) throw new Error("no encontré la tabla 'Anchos Navegables Canal Martín García' en la página de la CARP");
  const resto = texto.slice(ini);
  const rel = resto.match(/Relevamiento\s+([a-záéíóúñ]+\s+\d{4})/i);
  if (!rel) throw new Error("no encontré la fecha del relevamiento ('Relevamiento <mes> <año>')");
  const t = resto.slice(0, rel.index).split("\n").map((x) => x.trim()).filter(Boolean);

  // Cada tramo: "39,0-54,8" | nombre | determinante | ancho | profundidad
  const tramos: TramoCarp[] = [];
  for (let i = 0; i < t.length; i++) {
    const m = t[i].match(/^(\d+(?:,\d+)?)\s*-\s*(\d+(?:,\d+)?)$/);
    if (!m || i + 4 >= t.length) continue;
    const desde = num(m[1]), hasta = num(m[2]), ancho = num(t[i + 3]), prof = num(t[i + 4]);
    if (desde == null || hasta == null || ancho == null || prof == null) throw new Error(`renglón ilegible cerca de "${t[i]} ${t[i + 1]}"`);
    tramos.push({ nombre: t[i + 1], desde, hasta, ancho, prof });
    i += 4;
  }
  return { tramos, relevamiento: rel[1].toLowerCase() };
}

async function revisar(url: string) {
  let r: Response;
  try {
    r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new Error(`la página de la CARP no responde (${e instanceof Error ? e.name : "sin conexión"}): se sigue con la última tabla buena`);
  }
  if (!r.ok) throw new Error(`la página de la CARP respondió HTTP ${r.status}`);
  const { tramos, relevamiento } = leerTabla(await r.text());

  const guardados = await sql`select orden, nombre, km_desde, km_hasta, ancho_m, profundidad_m, relevamiento from public.tramos_canal order by orden`;
  if (tramos.length !== guardados.length) throw new Error(`la CARP muestra ${tramos.length} tramos y hay ${guardados.length} guardados: no se cambió nada`);

  // Primero se controla todo; si algo no cuadra, no se toca ninguna fila.
  const cambios: { orden: number; ancho: number; prof: number; antes: string; ahora: string }[] = [];
  for (const g of guardados) {
    const c = tramos.find((x) => norm(x.nombre) === norm(g.nombre));
    if (!c) throw new Error(`no encontré "${g.nombre}" en la tabla de la CARP: no se cambió nada`);
    if (Math.abs(c.desde - Number(g.km_desde)) > 0.05 || Math.abs(c.hasta - Number(g.km_hasta)) > 0.05)
      throw new Error(`"${g.nombre}" cambió de km en la CARP (${c.desde}–${c.hasta}): no se cambió nada, revisar a mano`);
    if (c.prof < 8 || c.prof > 15 || c.ancho < 50 || c.ancho > 400)
      throw new Error(`"${g.nombre}" trae valores raros (prof ${c.prof} m, ancho ${c.ancho} m): no se cambió nada`);
    if (c.prof !== Number(g.profundidad_m) || c.ancho !== Number(g.ancho_m) || relevamiento !== g.relevamiento)
      cambios.push({ orden: g.orden, ancho: c.ancho, prof: c.prof,
        antes: `${g.profundidad_m} m, ${g.ancho_m} m, ${g.relevamiento}`, ahora: `${c.prof} m, ${c.ancho} m, ${relevamiento}` });
  }
  if (cambios.length) {
    await sql.begin(async (tx) => {
      for (const c of cambios)
        await tx`update public.tramos_canal set profundidad_m = ${c.prof}, ancho_m = ${c.ancho}, relevamiento = ${relevamiento},
          actualizado_en = now(), cambio_carp_en = now() where orden = ${c.orden}`;
    });
  }
  return { relevamiento, tramos: tramos.length, novedad: cambios.length ? "relevamiento nuevo" : "sin cambios", cambios };
}

async function registrar(ok: boolean, detalle: unknown, error?: string) {
  if (ok) {
    await sql`insert into public.estado_fuentes (fuente, ultimo_ok, detalle) values ('carp_tramos', now(), ${sql.json(detalle as any)})
      on conflict (fuente) do update set ultimo_ok = now(), detalle = excluded.detalle`;
  } else {
    await sql`insert into public.estado_fuentes (fuente, ultimo_error, mensaje_error) values ('carp_tramos', now(), ${error ?? ""})
      on conflict (fuente) do update set ultimo_error = now(), mensaje_error = excluded.mensaje_error`;
  }
}

Deno.serve(async (req) => {
  const [s] = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'token_robot'`;
  if (!s || req.headers.get("x-token-robot") !== s.decrypted_secret) return new Response("no autorizado", { status: 401 });
  const url = new URL(req.url).searchParams.get("probar_falla") === "1" ? PAGINA_FALLA : PAGINA;
  try {
    const r = await revisar(url);
    await registrar(true, r);
    return new Response(JSON.stringify(r, null, 1), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await registrar(false, null, msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
