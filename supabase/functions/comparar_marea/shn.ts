// Lectores de las paginas del SHN (Servicio de Hidrografia Naval). Funciones puras: se prueban en la compu.
// Horas del SHN: hora oficial argentina = UTC-3, igual que Uruguay (verificado: la serie de Pilote Norden
// del SHN coincide hora a hora con la de la CARP, sin desfase).

export type FilaPron = { lugar: string; lugarTexto: string; estado: "pleamar" | "bajamar"; hora: string; altura_m: number; dudosa: boolean; motivo: string | null };
export type Pronostico = { desde: string; hasta: string; fecha: string | null; correccionInterior: string | null; correccionExterior: string | null; filas: FilaPron[] };
export type Altura = { estacion: string; ts: string; altura_m: number };

const ENT: Record<string, string> = { aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", nbsp: " ", amp: "&" };
const entidades = (s: string) => s.replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] ?? m).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const lineas = (html: string) => entidades(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n"))
  .split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
// "18/11/2026" + "15:00" -> ISO en UTC (hora argentina = UTC-3)
const iso = (fecha: string, hora: string) => { const [d, m, a] = fecha.split("/"); return new Date(`${a}-${m}-${d}T${hora}:00-03:00`).toISOString(); };

const LUGARES: [RegExp, string][] = [[/LA PLATA/i, "la_plata"], [/BUENOS AIRES/i, "buenos_aires"], [/SAN FERNANDO/i, "san_fernando"], [/MART[IÍ]N GARC[IÍ]A/i, "martin_garcia"], [/OYARVIDE|PUNTA INDIO/i, "oyarvide"]];
const lugarId = (t: string) => LUGARES.find(([r]) => r.test(t))?.[1] ?? t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const ENCABEZADOS = new Set(["LUGAR", "ESTADO", "HORA", "ALTURA (m)", "FECHA", "Valores corregidos"]);

export function leerPronostico(html: string): Pronostico {
  const L = lineas(html), todo = L.join(" ");
  const v = todo.match(/VALIDO DESDE LAS\s*(\d\d:\d\d)\s*Hs DE\s*(\d\d\/\d\d\/\d{4})\s*HASTA LAS\s*(\d\d:\d\d)\s*Hs DE\s*(\d\d\/\d\d\/\d{4})/i);
  if (!v) throw new Error("no encontré 'VALIDO DESDE ... HASTA ...' en el pronóstico del SHN (¿cambió la página?)");
  const desde = iso(v[2], v[1]), hasta = iso(v[4], v[3]);
  const fecha = todo.match(/FECHA:\s*([^|]*?\d{4})/i)?.[1]?.trim() ?? null;
  const corr = (seccion: RegExp) => { const i = L.findIndex((x) => seccion.test(x)); if (i < 0) return null; const j = L.findIndex((x, k) => k > i && /^Correcci[oó]n a las alturas/i.test(x)); return j > 0 && L[j + 1] ? L[j + 1] : null; };
  const filas: FilaPron[] = [];
  let lugar: string | null = null;
  const esFila = (i: number) => /^(PLEAMAR|BAJAMAR)$/i.test(L[i] ?? "") && /^\d\d:\d\d$/.test(L[i + 1] ?? "") && /^\d+([.,]\d+)?$/.test(L[i + 2] ?? "") && /^\d\d\/\d\d\/\d{4}$/.test(L[i + 3] ?? "");
  for (let i = 0; i < L.length; i++) {
    const x = L[i];
    if (esFila(i)) {
      if (!lugar) continue;
      filas.push({ lugar: lugarId(lugar), lugarTexto: lugar, estado: x.toLowerCase() as "pleamar" | "bajamar", hora: iso(L[i + 3], L[i + 1]),
        altura_m: Number(L[i + 2].replace(",", ".")), dudosa: false, motivo: null });
      i += 3;
    } else if (!ENCABEZADOS.has(x) && esFila(i + 1) && /[A-Za-zÁÉÍÓÚÑ]{4,}/.test(x)) {
      lugar = x; // el nombre del puerto es el renglon que esta justo antes de su primera pleamar/bajamar
    }
  }
  if (!filas.length) throw new Error("el pronóstico del SHN no trajo ninguna pleamar ni bajamar (¿cambió la página?)");
  // Fechas mal cargadas: en cada puerto los horarios van en orden. Si uno rompe el orden (o queda lejisimos
  // de la validez), se marcan como dudosos los dos involucrados: se guardan, pero no se usan para comparar.
  const t0 = Date.parse(desde) - 3 * 3600e3, t1 = Date.parse(hasta) + 12 * 3600e3;
  for (const id of new Set(filas.map((f) => f.lugar))) {
    const fs = filas.filter((f) => f.lugar === id);
    fs.forEach((f, k) => {
      const t = Date.parse(f.hora);
      if (t < t0 || t > t1) { f.dudosa = true; f.motivo = "fecha lejos de la validez del pronóstico"; }
      const sig = fs[k + 1];
      if (sig && Date.parse(sig.hora) <= t) for (const g of [f, sig]) { g.dudosa = true; g.motivo = "horarios fuera de orden (¿fecha mal cargada?)"; }
    });
  }
  return { desde, hasta, fecha, correccionInterior: corr(/RIO DE LA PLATA INTERIOR/i), correccionExterior: corr(/RIO DE LA PLATA EXTERIOR/i), filas };
}

// CSV "Alturas horarias" del SHN (10 dias). Se guardan las 4 estaciones cercanas al canal.
const COLUMNAS: Record<string, string> = { "martin garcia": "martin_garcia", "san fernando": "san_fernando", "buenos aires": "buenos_aires", "pilote norden": "norden" };
const sinTilde = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\uFFFD/g, "").toLowerCase().trim();
export function leerAlturas(csv: string): Altura[] {
  const filas = csv.split(/\r?\n/).filter((x) => x.trim());
  if (!filas.length) throw new Error("el CSV de alturas del SHN vino vacío");
  const cab = filas[0].split(";").map((c) => sinTilde(c).replace(/mart.n garc.a/, "martin garcia"));
  const idx = Object.entries(COLUMNAS).map(([nombre, id]) => [cab.indexOf(nombre), id] as const);
  const faltan = idx.filter(([i]) => i < 0).map(([, id]) => id);
  if (faltan.length || !/fecha/.test(cab[0])) throw new Error(`el CSV del SHN cambió de formato (no encontré: ${faltan.join(", ") || "Fecha y hora"})`);
  const out: Altura[] = [];
  for (const f of filas.slice(1)) {
    const c = f.split(";"), m = c[0]?.match(/^(\d\d\/\d\d\/\d{4}) (\d\d:\d\d)$/);
    if (!m) continue;
    const ts = iso(m[1], m[2]);
    for (const [i, id] of idx) { const v = Number((c[i] ?? "").replace(",", ".")); if ((c[i] ?? "").trim() !== "" && Number.isFinite(v)) out.push({ estacion: id, ts, altura_m: v }); }
  }
  if (!out.length) throw new Error("el CSV del SHN no trajo ninguna altura");
  return out;
}
