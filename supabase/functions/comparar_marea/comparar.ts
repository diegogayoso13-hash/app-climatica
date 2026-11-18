// Comparaciones del robot "comparar_marea". Funciones puras: se prueban en la compu.
// A. Diferencia de cero en Norden: altura SHN - altura CARP, hora por hora (y saltos).
// B. Pronostico SHN contra lo que midio el SHN en el mismo puerto.
// C. Pronostico SHN (San Fernando, Buenos Aires) contra lo real de la CARP en Norden y Colonia.
export type Punto = { t: number; v: number };           // t en ms, v en metros
export type Extremo = { lugar: string; estado: "pleamar" | "bajamar"; t: number; v: number };

const prom = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const disp = (a: number[]) => { if (a.length < 2) return 0; const m = prom(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const r2 = (x: number) => Math.round(x * 100) / 100;
const mediana = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// Valor de la CARP a una hora: promedio de las lecturas a +-3 min (la CARP mide cada 6 min).
export function valorEn(serie: Punto[], t: number, tol = 3 * 60000): number | null {
  const xs = serie.filter((p) => Math.abs(p.t - t) <= tol).map((p) => p.v);
  return xs.length ? prom(xs) : null;
}

export const SALTO_M = 0.10; // un cambio de mas de 10 cm de una hora a la otra en la diferencia es un "salto"
export function desfaseNorden(shn: Punto[], carp: Punto[]) {
  const pares = shn.map((p) => { const c = valorEn(carp, p.t); return c == null ? null : { t: p.t, d: p.v - c }; })
    .filter((x): x is { t: number; d: number } => x != null).sort((a, b) => a.t - b.t);
  if (!pares.length) return { n: 0, actual: null, dispersion: null, min: null, max: null, saltos: [] as { t: number; antes: number; despues: number }[] };
  const saltos: { t: number; antes: number; despues: number }[] = [];
  for (let i = 1; i < pares.length; i++)
    if (pares[i].t - pares[i - 1].t <= 2 * 3600e3 && Math.abs(pares[i].d - pares[i - 1].d) > SALTO_M)
      saltos.push({ t: pares[i].t, antes: r2(pares[i - 1].d), despues: r2(pares[i].d) });
  // "Actual": desde el ultimo salto, o las ultimas 24 h si no hubo.
  const desde = saltos.length ? saltos[saltos.length - 1].t : pares[pares.length - 1].t - 24 * 3600e3;
  const ult = pares.filter((p) => p.t >= desde).map((p) => p.d);
  const todos = pares.map((p) => p.d);
  return { n: pares.length, actual: r2(mediana(ult)), dispersion: r2(disp(ult)), min: r2(Math.min(...todos)), max: r2(Math.max(...todos)), saltos };
}

// Busca la pleamar (maximo) o bajamar (minimo) real cerca de la hora pronosticada.
// Si el extremo queda en el borde de la ventana, no se sabe cual es: no se usa.
export function extremoReal(serie: Punto[], t: number, estado: "pleamar" | "bajamar", ventanaH: number, minPuntos: number): Punto | null {
  const w = ventanaH * 3600e3;
  const xs = serie.filter((p) => Math.abs(p.t - t) <= w).sort((a, b) => a.t - b.t);
  if (xs.length < minPuntos) return null;
  const e = xs.reduce((a, p) => (estado === "pleamar" ? p.v > a.v : p.v < a.v) ? p : a);
  if (e === xs[0] || e === xs[xs.length - 1]) return null;
  return e;
}

export type Resultado = { n: number; altura_media: number | null; altura_disp: number | null; hora_media_h: number | null; hora_disp_h: number | null };
export function comparar(pron: Extremo[], serie: Punto[], ventanaH: number, minPuntos: number, hasta = Date.now()): Resultado {
  const errs = pron.filter((p) => p.t + ventanaH * 3600e3 <= hasta).map((p) => {
    const e = extremoReal(serie, p.t, p.estado, ventanaH, minPuntos);
    return e ? { dv: p.v - e.v, dh: (p.t - e.t) / 3600e3 } : null; // dv > 0: el pronostico dio mas alto que lo real
  }).filter((x): x is { dv: number; dh: number } => x != null);
  if (!errs.length) return { n: 0, altura_media: null, altura_disp: null, hora_media_h: null, hora_disp_h: null };
  return { n: errs.length, altura_media: r2(prom(errs.map((e) => e.dv))), altura_disp: r2(disp(errs.map((e) => e.dv))),
    hora_media_h: r2(prom(errs.map((e) => e.dh))), hora_disp_h: r2(disp(errs.map((e) => e.dh))) };
}

// De cada pleamar/bajamar pronosticada varias veces, queda la de la emision mas nueva anterior al hecho.
export function ultimaVersion(filas: { lugar: string; estado: "pleamar" | "bajamar"; hora: string; altura_m: number; emision: string; dudosa: boolean }[]): Extremo[] {
  const m = new Map<string, { e: Extremo; em: number }>();
  for (const f of filas) {
    if (f.dudosa) continue;
    const t = Date.parse(f.hora), em = Date.parse(f.emision);
    if (em > t) continue;
    const k = `${f.lugar}|${f.estado}|${Math.round(t / 3600e3)}`;
    const a = m.get(k);
    if (!a || em > a.em) m.set(k, { e: { lugar: f.lugar, estado: f.estado, t, v: f.altura_m }, em });
  }
  return [...m.values()].map((x) => x.e).sort((a, b) => a.t - b.t);
}
