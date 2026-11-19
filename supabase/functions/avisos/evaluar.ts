// Decide que avisos le tocan a un celular. Funcion pura: se prueba en la compu con datos de PRUEBA.
//  1-2 (SMN, novedad del canal): eventos; cada uno una sola vez. Al activar el aviso, lo que ya estaba vigente
//      se toma como "ya visto" (solo avisa lo NUEVO). En silencio no se manda; al terminar, los que siguen
//      vigentes salen en un aviso por tipo.
//  3-6 (niebla, marea, tramo en rojo, viento): condiciones. Avisa al pasar de "no" a "si", con 1 h minima entre
//      avisos del mismo tipo, y no repite hasta que se normalice. Dato viejo (mas de 20 min) = no se evalua.
import type { Prefs, Tipo } from "./validar.ts";

export const VIEJO_MS = 20 * 60000, HORA_MS = 3600e3;
export type Lectura = { v: number; ts: number };
export type Datos = {
  ahora: number;
  marea: Record<string, Lectura | null>;                // ultima marea de cada estacion (norden, colonia, conchillas, carmelo)
  viento: { v: number; g: number | null; ts: number } | null; // Norden
  tramos: { nombre: string; prof: number; e1: string; e2: string }[];
  alertas: { clave: string; evento: string; severidad: string; donde: string; hasta: number }[];
  novedades: { clave: string; texto: string }[];        // clave = id de la novedad (cambia si vuelve a aparecer)
  vis: { t: number; v: number }[];                      // visibilidad pronosticada (la mas baja de los modelos), por hora
};
export type Estado = { activo: boolean; ultimo: number | null };
export type Mensaje = { tipo: Tipo; titulo: string; cuerpo: string; ir: string; ttl: number };

const n2 = (x: number) => x.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (x: number) => String(Math.round(x));
const cm = (x: number) => Math.round(x * 100) / 100;
const minUY = (ms: number) => (((ms / 60000 - 180) % 1440) + 1440) % 1440; // Uruguay = UTC-3
const hm = (ms: number) => { const m = minUY(ms); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`; };
const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
export function enSilencio(prefs: Prefs, ahora: number) {
  if (!prefs.silencio) return false;
  const m = minUY(ahora), a = aMin(prefs.silencio.desde), b = aMin(prefs.silencio.hasta);
  return a < b ? m >= a && m < b : m >= a || m < b; // cruza la medianoche (ej. 23:00 a 06:00)
}
const fresco = (l: { ts: number } | null | undefined, ahora: number) => !!l && ahora - l.ts <= VIEJO_MS;

// Condiciones 3 a 6: true / false, o null si no se puede evaluar (dato viejo o falta un ajuste).
export function condiciones(d: Datos, p: Prefs) {
  const c: Partial<Record<Tipo, { si: boolean; texto?: string } | null>> = {};
  // 3. niebla: menos de 1000 m en las proximas 12 h
  if (!d.vis.length) c.niebla = null;
  else {
    const h = d.vis.filter((x) => x.t >= d.ahora - 30 * 60000 && x.t <= d.ahora + 12 * HORA_MS && x.v < 1000).sort((a, b) => a.t - b.t)[0];
    c.niebla = { si: !!h, texto: h ? `Menos de 1 km desde las ${hm(h.t)}` : undefined };
  }
  // 4. marea real de Norden bajo el minimo
  const mn = d.marea.norden;
  c.marea = p.rioMin == null || !fresco(mn, d.ahora) ? null
    : { si: mn!.v < p.rioMin, texto: `Norden ${n2(mn!.v)} m (tu mínimo ${n2(p.rioMin)} m)` };
  // 5. tramo en rojo con el calado (la marea del tramo es la mas baja de sus dos estaciones con dato nuevo)
  if (p.calado == null) c.tramo = null;
  else {
    const filas = d.tramos.map((t) => {
      const ms = [d.marea[t.e1], d.marea[t.e2]].filter((l) => fresco(l, d.ahora)).map((l) => l!.v);
      if (!ms.length) return null;
      const quilla = cm(cm(t.prof + Math.min(...ms)) - p.calado!);
      return { t, quilla, rojo: quilla < cm(Math.max(0.6, p.margen)) };
    }).filter((x): x is NonNullable<typeof x> => x != null);
    if (!filas.length) c.tramo = null;
    else {
      const peor = filas.reduce((a, f) => f.quilla < a.quilla ? f : a);
      c.tramo = { si: filas.some((f) => f.rojo), texto: `${peor.t.nombre}, quedan ${n2(peor.quilla)} m bajo la quilla` };
    }
  }
  // 6. viento o rafaga en Norden sobre el limite (nivel elegido: amarillo o rojo del engranaje)
  if (!fresco(d.viento, d.ahora)) c.viento = null;
  else {
    const lv = p.nivelViento === "amarillo" ? p.vAmar : p.vRojo, lg = p.nivelViento === "amarillo" ? p.gAmar : p.gRojo, w = d.viento!;
    c.viento = { si: w.v >= lv || (w.g != null && w.g >= lg), texto: `${n0(w.v)} kn${w.g != null ? `, ráfaga ${n0(w.g)}` : ""} (tu límite: ${n0(lv)} / ${n0(lg)})` };
  }
  return c;
}

const TITULO: Record<Tipo, string> = { smn: "Alerta del SMN", canal: "Novedad del canal", niebla: "Niebla prevista", marea: "Marea bajo tu mínimo", tramo: "Tramo en rojo", viento: "Viento en Norden" };
const IR: Record<Tipo, string> = { smn: "sec-alertas", canal: "sec-novedades", niebla: "sec-pron", marea: "sec-norden", tramo: "sec-resumen", viento: "sec-norden" };
const TTL: Record<Tipo, number> = { smn: 6 * 3600, canal: 6 * 3600, niebla: 3 * 3600, marea: 1800, tramo: 1800, viento: 1800 };
const msg = (tipo: Tipo, cuerpo: string): Mensaje => ({ tipo, titulo: `Tu Faro · ${TITULO[tipo]}`, cuerpo, ir: IR[tipo], ttl: TTL[tipo] });

/**
 * estado: lo guardado de este celular por tipo (null = el aviso recien se activo, para 1-2 es la "linea de base").
 * enviados: claves "tipo|clave" ya avisadas a este celular.
 */
export function evaluar(d: Datos, p: Prefs, estado: Partial<Record<Tipo, Estado | null>>, enviados: Set<string>) {
  const mensajes: Mensaje[] = [], marcar: { tipo: Tipo; clave: string }[] = [], nuevoEstado: Partial<Record<Tipo, Estado | null>> = {};
  const silencio = enSilencio(p, d.ahora);
  // 1-2: eventos
  const eventos: Record<"smn" | "canal", { clave: string; texto: string }[]> = {
    smn: d.alertas.filter((a) => a.hasta > d.ahora).map((a) => ({ clave: a.clave, texto: `${a.evento} (${a.severidad}) para ${a.donde}, hasta las ${hm(a.hasta)}` })),
    canal: d.novedades,
  };
  for (const tipo of ["smn", "canal"] as const) {
    if (!p.avisos[tipo]) { nuevoEstado[tipo] = null; continue; }
    const pend = eventos[tipo].filter((e) => !enviados.has(`${tipo}|${e.clave}`));
    if (!estado[tipo]) { // recien activado: lo que ya estaba vigente no se avisa
      for (const e of pend) marcar.push({ tipo, clave: e.clave });
      nuevoEstado[tipo] = { activo: false, ultimo: null };
      continue;
    }
    if (!pend.length || silencio) continue;
    mensajes.push(msg(tipo, pend.length === 1 ? pend[0].texto
      : `${pend.length} ${tipo === "smn" ? "alertas del SMN vigentes" : "novedades del canal"}: ${pend.slice(0, 3).map((e) => e.texto).join(" · ")}${pend.length > 3 ? "…" : ""}`));
    for (const e of pend) marcar.push({ tipo, clave: e.clave });
  }
  // 3-6: condiciones
  const c = condiciones(d, p);
  for (const tipo of ["niebla", "marea", "tramo", "viento"] as const) {
    if (!p.avisos[tipo]) { nuevoEstado[tipo] = null; continue; }
    const st: Estado = estado[tipo] ? { ...estado[tipo]! } : { activo: false, ultimo: null };
    const r = c[tipo];
    if (r == null) { nuevoEstado[tipo] = st; continue; }          // no se puede evaluar: no se toca nada
    if (r.si && !st.activo) {
      if (!silencio && (st.ultimo == null || d.ahora - st.ultimo >= HORA_MS)) {
        mensajes.push(msg(tipo, r.texto!)); st.activo = true; st.ultimo = d.ahora;
      } // si no: queda pendiente (sigue "no activo") y se avisa cuando se pueda
    } else if (!r.si && st.activo) st.activo = false;              // se normalizo: puede volver a avisar
    nuevoEstado[tipo] = st;
  }
  return { mensajes, marcar, estado: nuevoEstado };
}
