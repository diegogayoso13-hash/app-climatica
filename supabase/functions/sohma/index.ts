// Robot "sohma": cada hora revisa si el SOHMA publico un PDF nuevo de "Avisos Vigentes a las 13hs".
// Si hay uno nuevo, lo lee y guarda solo las novedades del Canal Martin Garcia.
import postgres from "npm:postgres@3.4.5";
import { getDocumentProxy } from "npm:unpdf@0.12.1";
import { renglonesPorPagina } from "./renglones.ts";
import { analizar, type Config } from "./parser.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const UA = "Mozilla/5.0 (app-climatica)";
const PAGINA = "https://sohma.armada.mil.uy/index.php/servicios/avisos-a-los-navegantes";

async function registrar(ok: boolean, detalle: unknown, error?: string) {
  if (ok) {
    await sql`insert into public.estado_fuentes (fuente, ultimo_ok, detalle) values ('sohma', now(), ${sql.json(detalle as any)})
      on conflict (fuente) do update set ultimo_ok = now(), detalle = excluded.detalle`;
  } else {
    await sql`insert into public.estado_fuentes (fuente, ultimo_error, mensaje_error) values ('sohma', now(), ${error ?? ""})
      on conflict (fuente) do update set ultimo_error = now(), mensaje_error = excluded.mensaje_error`;
  }
}

async function revisar(forzar: boolean) {
  // 1. Buscar el enlace "Avisos Vigentes a las 13hs" en la pagina (el nombre del PDF cambia cada dia).
  const html = await (await fetch(PAGINA, { headers: { "User-Agent": UA } })).text();
  const m = [...html.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .find((x) => /vigentes\s+a\s+las/i.test(x[2].replace(/<[^>]+>/g, " ")));
  if (!m) throw new Error("no encontré el enlace 'Avisos Vigentes a las 13hs' en la página del SOHMA");
  const url = new URL(m[1].replace(/ /g, "%20"), PAGINA).toString();
  const archivo = decodeURIComponent(url.split("/").pop()!);

  // 2. Bajar el PDF solo si es nuevo (otro nombre u otra fecha de publicacion).
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`el PDF ${archivo} respondió HTTP ${r.status}`);
  const publicado = r.headers.get("last-modified") ? new Date(r.headers.get("last-modified")!).toISOString() : null;
  const [ya] = await sql`select ok, publicado from public.sohma_pdfs where archivo = ${archivo}`;
  if (ya && ya.ok && String(ya.publicado ? new Date(ya.publicado).toISOString() : null) === String(publicado) && !forzar) {
    await r.body?.cancel();
    return { archivo, novedad: "sin PDF nuevo" };
  }
  const buf = new Uint8Array(await r.arrayBuffer());

  // 3. Leer y filtrar.
  const [cfgFila] = await sql`select valor from public.configuracion where clave = 'canal_martin_garcia'`;
  const cfg = cfgFila.valor as Config;
  const pdf = await getDocumentProxy(buf);
  const res = analizar(await renglonesPorPagina(pdf), cfg);
  const ok = res.encabezadoCanalEncontrado;

  await sql`insert into public.sohma_pdfs ${sql({
    archivo, url, publicado, ok, canal_encontrado: res.encabezadoCanalEncontrado, problemas: res.problemas,
    lista_emitido: res.listaBalizamiento?.emitido ?? null, lista_vigente_hasta: res.listaBalizamiento?.vigenteHasta ?? null,
    cantidad_radioavisos: res.radioavisos.length, cantidad_balizas: res.balizas.length,
  })} on conflict (archivo) do update set url = excluded.url, publicado = excluded.publicado, leido_en = now(), ok = excluded.ok,
    canal_encontrado = excluded.canal_encontrado, problemas = excluded.problemas, lista_emitido = excluded.lista_emitido,
    lista_vigente_hasta = excluded.lista_vigente_hasta, cantidad_radioavisos = excluded.cantidad_radioavisos, cantidad_balizas = excluded.cantidad_balizas`;

  // Si no se pudo leer bien el balizamiento del canal, NO se toca nada (no se "normaliza" lo que no se vio).
  if (!ok) return { archivo, novedad: "PDF leído con problemas: no se actualizaron las novedades", problemas: res.problemas };

  // 4. Guardar novedades: lo nuevo entra con "visto desde" hoy; lo que sigue, se actualiza.
  const filas = [
    ...res.radioavisos.map((a) => ({
      id: `avur|${a.avur}`, tipo: "radioaviso", clave: a.avur, tramo: null, km: null, descripcion: a.titulo, estado: null,
      texto: a.texto, emitido: a.emitido, vigente_hasta: a.vigenteHasta, anula: a.anula,
    })),
    ...res.balizas.map((b) => ({
      id: `baliza|${b.senal}|${b.estado}`, tipo: "baliza", clave: b.senal, tramo: b.tramo, km: b.km, descripcion: b.tipo, estado: b.estado,
      texto: b.detalle, emitido: res.listaBalizamiento?.emitido ?? null, vigente_hasta: res.listaBalizamiento?.vigenteHasta ?? null, anula: null,
    })),
  ].map((f) => ({ ...f, archivo_primera: archivo, archivo_ultima: archivo }));
  const ids = filas.map((f) => f.id);
  await sql.begin(async (tx) => {
    if (filas.length) {
      await tx`insert into public.novedades_canal ${tx(filas)}
        on conflict (id) do update set tramo = excluded.tramo, km = excluded.km, descripcion = excluded.descripcion,
          texto = excluded.texto, emitido = excluded.emitido, vigente_hasta = excluded.vigente_hasta, anula = excluded.anula,
          ultima_vez = now(), archivo_ultima = excluded.archivo_ultima,
          -- si habia sido normalizada y vuelve a aparecer, es una novedad nueva
          primera_vez = case when novedades_canal.normalizada_en is not null then now() else novedades_canal.primera_vez end,
          archivo_primera = case when novedades_canal.normalizada_en is not null then excluded.archivo_primera else novedades_canal.archivo_primera end,
          normalizada_en = null`;
    }
    // Lo que estaba activo y ya no figura: normalizada (o radioaviso que ya no esta vigente).
    await tx`update public.novedades_canal set normalizada_en = now()
      where normalizada_en is null and not (id = any(${ids}))`;
  });
  return { archivo, novedad: "PDF nuevo leído", radioavisos: res.radioavisos.length, balizas: res.balizas.length, problemas: res.problemas };
}

Deno.serve(async (req) => {
  const [s] = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'token_robot'`;
  if (!s || req.headers.get("x-token-robot") !== s.decrypted_secret) return new Response("no autorizado", { status: 401 });
  const forzar = new URL(req.url).searchParams.get("forzar") === "1";
  const t0 = performance.now();
  try {
    const r = await revisar(forzar);
    const detalle = { ...r, ms: Math.round(performance.now() - t0) };
    await registrar(true, detalle);
    return new Response(JSON.stringify(detalle, null, 1), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await registrar(false, null, msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
