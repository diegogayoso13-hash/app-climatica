// Robot "recolectar": corre cada 5 minutos (pg_cron) y guarda datos reales,
// pronosticos y alertas en la base. Cada fuente es independiente: si una falla,
// las demas siguen y el error queda anotado en estado_fuentes.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const UA = "Mozilla/5.0 (app-climatica)";
const TZ_UY = "-03:00"; // Uruguay no tiene horario de verano

// ---------- utilidades ----------
const num = (x: unknown) => {
  const n = parseFloat(String(x ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const fechaUY = (s: string) => new Date(s.replace(" ", "T") + TZ_UY); // "2026-11-16 09:36:00"
// La CARP manda epoch "hora local leida como UTC": hay que sumarle 3 h.
const epochUY = (ms: number) => new Date(ms + 3 * 3600 * 1000);

async function registrar(fuente: string, ok: boolean, detalle: unknown, error?: string) {
  if (ok) {
    await sql`insert into public.estado_fuentes (fuente, ultimo_ok, detalle) values (${fuente}, now(), ${sql.json(detalle as any)})
      on conflict (fuente) do update set ultimo_ok = now(), detalle = excluded.detalle`;
  } else {
    await sql`insert into public.estado_fuentes (fuente, ultimo_error, mensaje_error) values (${fuente}, now(), ${error ?? ""})
      on conflict (fuente) do update set ultimo_error = now(), mensaje_error = excluded.mensaje_error`;
  }
}

type Lectura = {
  estacion: string; ts: Date; viento_kn?: number | null; rafaga_kn?: number | null; dir_grados?: number | null;
  marea_m?: number | null; presion_hpa?: number | null; temp_c?: number | null; humedad_pct?: number | null;
};

// Guarda lecturas; si la fila ya existe, completa solo los campos que faltaban.
async function guardarLecturas(ls: Lectura[]) {
  if (!ls.length) return 0;
  // Une las piezas de la misma hora (viento, rafaga y marea pueden venir por separado).
  const CAMPOS = ["viento_kn", "rafaga_kn", "dir_grados", "marea_m", "presion_hpa", "temp_c", "humedad_pct"] as const;
  const porClave = new Map<string, Record<string, unknown>>();
  for (const l of ls) {
    const k = l.estacion + "|" + l.ts.toISOString();
    const f = porClave.get(k) ?? Object.fromEntries([["estacion", l.estacion], ["ts", l.ts.toISOString()], ...CAMPOS.map((c) => [c, null])]);
    for (const c of CAMPOS) if (f[c] === null && l[c] != null) f[c] = l[c];
    porClave.set(k, f);
  }
  const filas = [...porClave.values()];
  await sql`
    insert into public.lecturas ${sql(filas)}
    on conflict (estacion, ts) do update set
      viento_kn   = coalesce(lecturas.viento_kn,   excluded.viento_kn),
      rafaga_kn   = coalesce(lecturas.rafaga_kn,   excluded.rafaga_kn),
      dir_grados  = coalesce(lecturas.dir_grados,  excluded.dir_grados),
      marea_m     = coalesce(lecturas.marea_m,     excluded.marea_m),
      presion_hpa = coalesce(lecturas.presion_hpa, excluded.presion_hpa),
      temp_c      = coalesce(lecturas.temp_c,      excluded.temp_c),
      humedad_pct = coalesce(lecturas.humedad_pct, excluded.humedad_pct)`;
  return filas.length;
}

// ---------- 1. CARP: Norden, Colonia, Conchillas y Carmelo ----------
// Va por http: el https de la CARP solo acepta cifrados viejos que Deno rechaza. Son datos publicos.
const VISOR = "http://meteo.comisionriodelaplata.org/?w=900&h=450&lang=ES";
const ESTACIONES_CARP = { norden: 2, colonia: 1, conchillas: 4, carmelo: 3 } as const;

async function carp() {
  // El visor necesita una cookie de sesion y que el Referer sea la pagina de la CARP.
  const r0 = await fetch(VISOR, { headers: { "User-Agent": UA, Referer: "https://www.comisionriodelaplata.org/servicios_main.php?sid=VM" } });
  await r0.text();
  const cookie = r0.headers.getSetCookie().map((c) => c.split(";")[0].trim()).join("; ");
  const resultado: Record<string, unknown> = {};
  const errores: string[] = [];
  for (const [nombre, id] of Object.entries(ESTACIONES_CARP)) {
    try { resultado[nombre] = await carpEstacion(nombre, id, cookie); }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); resultado[nombre] = { error: msg }; errores.push(`${nombre}: ${msg}`); }
  }
  if (errores.length === Object.keys(ESTACIONES_CARP).length) throw new Error(errores.join(" | "));
  return resultado;
}

async function carpEstacion(estacion: string, id: number, cookie: string) {
  const r = await fetch("http://meteo.comisionriodelaplata.org/ecsCommand.php?c=telemetry%2FupdateTelemetry&s=" + Math.random(), {
    method: "POST",
    headers: { "User-Agent": UA, Referer: VISOR, Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: `p=1&p1=${id}&p2=1&p3=1`,
  });
  const txt = await r.text();
  if (!txt.startsWith("OK") || !txt.includes("JSON**")) throw new Error("respuesta inesperada: " + txt.slice(0, 120));
  const d = JSON.parse(txt.split("JSON**")[1]);

  const celdas = (html: string) => {
    const h = decodeURIComponent(html);
    const filas = [...h.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].trim()));
    return filas.find((f) => f.length >= 5) ?? [];
  };
  const out: Lectura[] = [];

  // Ultima lectura de viento (unico lugar donde viene la direccion): fecha, viento, rafaga, unidad, dir
  const w = celdas(d.wind?.latest ?? "");
  if (w.length) out.push({ estacion, ts: fechaUY(w[0]), viento_kn: num(w[1]), rafaga_kn: num(w[2]), dir_grados: num(w[4]) });
  // Ultima marea: fecha, altura
  const t = celdas(d.tide?.latest ?? "");
  if (t.length) out.push({ estacion, ts: fechaUY(t[0]), marea_m: num(t[1]) });

  // Series de 24 h (rellenan huecos si el robot falto alguna vez; no traen direccion)
  for (const s of d.wind?.chart?.gust?.series ?? []) {
    const campo = /viento/i.test(s.name) ? "viento_kn" : "rafaga_kn";
    for (const [ms, v] of s.data ?? []) out.push({ estacion, ts: epochUY(ms), [campo]: num(v) } as Lectura);
  }
  for (const s of d.tide?.chart?.series ?? []) {
    for (const [ms, v] of s.data ?? []) out.push({ estacion, ts: epochUY(ms), marea_m: num(v) });
  }
  if (!out.length) throw new Error("la estacion no trajo ningun dato");
  const n = await guardarLecturas(out);
  return {
    guardadas: n,
    ultimo_viento: w[0] ?? null, viento_kn: num(w[1]), rafaga_kn: num(w[2]), dir_grados: num(w[4]),
    ultima_marea: t[0] ?? null, marea_m: num(t[1]),
  };
}

// ---------- 2. Armada: Colonia (respaldo, en tierra, sin rafaga) ----------
async function armadaColonia() {
  const html = await (await fetch("https://meteo.armada.mil.uy/Est3Armada.php", { headers: { "User-Agent": UA } })).text();
  const out: Lectura[] = [];
  // <tr><th scope="row">16-11-2026 09:50:10</th><td>T</td><td>H</td><td>P</td><td>WS kts</td><td>179° S</td>...
  for (const m of html.matchAll(/<th scope="row">(\d\d)-(\d\d)-(\d{4}) (\d\d:\d\d:\d\d)<\/th>((?:<td>[^<]*<\/td>){5})/g)) {
    const td = [...m[5].matchAll(/<td>([^<]*)<\/td>/g)].map((x) => x[1]);
    out.push({
      estacion: "colonia_armada", ts: fechaUY(`${m[3]}-${m[2]}-${m[1]} ${m[4]}`),
      temp_c: num(td[0]), humedad_pct: num(td[1]), presion_hpa: num(td[2]), viento_kn: num(td[3]), dir_grados: num(td[4]),
    });
  }
  if (!out.length) throw new Error("no encontre filas en la tabla");
  await guardarLecturas(out);
  return { guardadas: out.length, ultima: out[0].ts.toISOString() };
}

// ---------- 3. Open-Meteo: solo cuando sale una corrida nueva ----------
const MODELOS = [
  { modelo: "ecmwf", api: "ecmwf_ifs025", meta: "ecmwf_ifs025" },
  { modelo: "gfs", api: "gfs_global", meta: "ncep_gfs025" },
  { modelo: "icon", api: "icon_global", meta: "dwd_icon" },
];
async function openMeteo() {
  const [cfg] = await sql`select valor from public.configuracion where clave = 'punto_pronostico'`;
  const { lat, lon } = cfg.valor;
  const resultado: Record<string, string> = {};
  const errores: string[] = [];
  for (const m of MODELOS) try {
    const rm = await fetch(`https://api.open-meteo.com/data/${m.meta}/static/meta.json`);
    const meta = rm.ok ? await rm.json() : null;
    if (!Number.isFinite(meta?.last_run_initialisation_time)) throw new Error(`no pude leer la hora de corrida (HTTP ${rm.status})`);
    const corrida = new Date(meta.last_run_initialisation_time * 1000);
    const [ya] = await sql`select 1 from public.pronosticos where modelo = ${m.modelo} and corrida = ${corrida.toISOString()}
      and lat = ${lat} and lon = ${lon} limit 1`;
    if (ya) { resultado[m.modelo] = "sin novedad (" + corrida.toISOString() + ")"; continue; }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code,cape` +
      `&models=${m.api}&wind_speed_unit=kn&timezone=GMT&forecast_days=6`;
    const j = await (await fetch(url)).json();
    if (j.error || !j.hourly) throw new Error(j.reason ?? "respuesta sin datos");
    const h = j.hourly;
    const filas = h.time.map((t: string, i: number) => ({
      modelo: m.modelo, corrida: corrida.toISOString(), hora: new Date(t + "Z").toISOString(),
      viento_kn: h.wind_speed_10m[i], rafaga_kn: h.wind_gusts_10m[i], dir_grados: h.wind_direction_10m[i],
      lluvia_mm: h.precipitation[i], codigo_tiempo: h.weather_code[i], cape: h.cape[i], lat, lon,
    })).filter((f: any) => f.viento_kn !== null);
    await sql`insert into public.pronosticos ${sql(filas)} on conflict do nothing`;
    resultado[m.modelo] = `nueva corrida ${corrida.toISOString()}: ${filas.length} horas`;
  } catch (e) {
    errores.push(`${m.modelo}: ${e instanceof Error ? e.message : e}`);
  }
  // Si fallaron los tres, cuenta como error de la fuente; si fallo alguno, queda anotado en el detalle.
  if (errores.length === MODELOS.length) throw new Error(errores.join(" | "));
  if (errores.length) resultado.errores = errores.join(" | ");
  return resultado;
}

// ---------- 4. Alertas SMN: solo archivos nuevos, despacio, filtrando por zona ----------
const PUNTOS = { norden: [-34.6286, -57.925], martin_garcia: [-34.183, -58.25] } as const;
const adentro = (lat: number, lon: number, poly: number[][]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const MAX_POR_PASADA = 10;
async function alertasSMN() {
  const page = await (await fetch("https://ssl.smn.gob.ar/CAP/AR.php", { headers: { "User-Agent": UA } })).text();
  let urls = [...new Set([...page.matchAll(/href="(https:\/\/ssl\.smn\.gob\.ar\/feeds\/CAP\/[^"]+\.xml)"/g)].map((m) => m[1]))];
  const vistos = new Set((await sql`select archivo from public.alertas_smn where archivo = any(${urls.map((u) => u.split("/").pop()!)})`).map((r) => r.archivo));
  urls = urls.filter((u) => !vistos.has(u.split("/").pop()!));
  urls.sort((a, b) => Number(b.includes("avisocortoplazo")) - Number(a.includes("avisocortoplazo"))); // urgentes primero
  let nuevos = 0, enZona = 0, bloqueado = false;
  for (const u of urls.slice(0, MAX_POR_PASADA)) {
    const r = await fetch(u, { headers: { "User-Agent": UA } });
    if (r.status === 429) { bloqueado = true; await r.body?.cancel(); break; }
    if (!r.ok) { await r.body?.cancel(); continue; }
    const x = await r.text();
    const g = (t: string) => (x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) ?? [])[1]?.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) ?? null;
    const polys = [...x.matchAll(/<polygon>([\s\S]*?)<\/polygon>/g)].map((m) => m[1].trim().split(/\s+/).map((p) => p.split(",").map(Number)));
    const tN = polys.some((p) => adentro(PUNTOS.norden[0], PUNTOS.norden[1], p));
    const tM = polys.some((p) => adentro(PUNTOS.martin_garcia[0], PUNTOS.martin_garcia[1], p));
    const zona = tN || tM;
    await sql`insert into public.alertas_smn ${sql({
      archivo: u.split("/").pop()!, url: u, toca_zona: zona, toca_norden: tN, toca_martin_garcia: tM,
      identificador: g("identifier"), tipo_mensaje: g("msgType"), evento: g("event"), severidad: g("severity"),
      desde: g("onset") ?? g("effective"), hasta: g("expires"), descripcion: zona ? g("description") : null,
    })} on conflict (archivo) do nothing`;
    nuevos++; if (zona) enZona++;
    await new Promise((res) => setTimeout(res, 3000));
  }
  return { en_lista: urls.length + vistos.size, pendientes: Math.max(0, urls.length - nuevos), revisados_ahora: nuevos, en_zona: enZona, bloqueado };
}

// ---------- entrada ----------
Deno.serve(async (req) => {
  const [s] = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'token_robot'`;
  if (!s || req.headers.get("x-token-robot") !== s.decrypted_secret) return new Response("no autorizado", { status: 401 });

  const fuentes: Record<string, () => Promise<unknown>> = { carp: carp, armada_colonia: armadaColonia, open_meteo: openMeteo, smn_alertas: alertasSMN };
  const resumen: Record<string, unknown> = {};
  // Las cuatro fuentes en paralelo (el SMN tarda mas porque va despacio a proposito).
  await Promise.all(Object.entries(fuentes).map(async ([nombre, fn]) => {
    try { const r = await fn(); resumen[nombre] = r; await registrar(nombre, true, r); }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); resumen[nombre] = { error: msg }; await registrar(nombre, false, null, msg); }
  }));
  return new Response(JSON.stringify(resumen, null, 1), { headers: { "Content-Type": "application/json" } });
});
