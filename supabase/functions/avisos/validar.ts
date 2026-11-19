// Control de lo que manda cada celular al anotarse o actualizar sus avisos. Funciones puras.
// Solo se aceptan numeros razonables, si/no y dos horas. Nada de texto libre.
import { servicioValido, b64u } from "./webpush.ts";

export const TIPOS = ["smn", "canal", "niebla", "marea", "tramo", "viento"] as const;
export type Tipo = typeof TIPOS[number];
export type Prefs = {
  avisos: Record<Tipo, boolean>;
  calado: number | null; margen: number; colchon: number; rioMin: number | null;
  vAmar: number; vNar: number; vRojo: number; gAmar: number; gRojo: number;
  nivelViento: "amarillo" | "rojo";
  silencio: { desde: string; hasta: string } | null;
};
const CLAVES = ["avisos", "calado", "margen", "colchon", "rioMin", "vAmar", "vNar", "vRojo", "gAmar", "gRojo", "nivelViento", "silencio"];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const num = (x: unknown, min: number, max: number, nulo = false) =>
  (nulo && x === null) || (typeof x === "number" && Number.isFinite(x) && x >= min && x <= max);

export function validarPrefs(x: any): { prefs: Prefs } | { error: string } {
  if (!x || typeof x !== "object" || Array.isArray(x)) return { error: "ajustes inválidos" };
  const sobran = Object.keys(x).filter((k) => !CLAVES.includes(k));
  if (sobran.length) return { error: `datos no permitidos: ${sobran.slice(0, 3).join(", ")}` };
  const a = x.avisos;
  if (!a || typeof a !== "object" || Array.isArray(a) || Object.keys(a).some((k) => !TIPOS.includes(k as Tipo)) || TIPOS.some((t) => typeof a[t] !== "boolean"))
    return { error: "lista de avisos inválida" };
  if (!num(x.calado, 0.1, 20, true)) return { error: "calado fuera de rango" };
  if (!num(x.margen, 0.6, 20)) return { error: "margen fuera de rango (desde 0,60 m)" };
  if (!num(x.colchon, 0, 20)) return { error: "colchón fuera de rango" };
  if (!num(x.rioMin, -5, 10, true)) return { error: "mínimo de marea fuera de rango" };
  for (const k of ["vAmar", "vNar", "vRojo"]) if (!num(x[k], 0, 200)) return { error: "límite de viento fuera de rango" };
  for (const k of ["gAmar", "gRojo"]) if (!num(x[k], 0, 200)) return { error: "límite de ráfaga fuera de rango" };
  if (x.nivelViento !== "amarillo" && x.nivelViento !== "rojo") return { error: "nivel de viento inválido" };
  const s = x.silencio;
  if (s !== null && (typeof s !== "object" || Object.keys(s).join() !== "desde,hasta" || !HORA.test(s.desde) || !HORA.test(s.hasta) || s.desde === s.hasta))
    return { error: "horario de silencio inválido" };
  return { prefs: { avisos: Object.fromEntries(TIPOS.map((t) => [t, a[t]])) as Record<Tipo, boolean>, calado: x.calado, margen: x.margen, colchon: x.colchon,
    rioMin: x.rioMin, vAmar: x.vAmar, vNar: x.vNar, vRojo: x.vRojo, gAmar: x.gAmar, gRojo: x.gRojo, nivelViento: x.nivelViento, silencio: s ? { desde: s.desde, hasta: s.hasta } : null } };
}

const b64Largo = (s: unknown, bytes: number) => { if (typeof s !== "string" || !/^[A-Za-z0-9_-]+$/.test(s) || s.length > 200) return false; try { return b64u.dec(s).length === bytes; } catch { return false; } };
export const LLAVE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes al azar

/** Pedido de la app: { accion, endpoint, ... }. Devuelve el pedido limpio o el error. */
export function validarPedido(x: any): { pedido: any } | { error: string } {
  if (!x || typeof x !== "object" || Array.isArray(x)) return { error: "pedido inválido" };
  const acc = x.accion;
  if (!["alta", "actualizar", "baja", "probar"].includes(acc)) return { error: "acción inválida" };
  if (typeof x.endpoint !== "string" || x.endpoint.length > 800 || !servicioValido(x.endpoint)) return { error: "dirección de avisos inválida" };
  const permitidas: Record<string, string[]> = { alta: ["accion", "endpoint", "p256dh", "auth", "prefs", "prueba"], actualizar: ["accion", "endpoint", "llave", "prefs"],
    baja: ["accion", "endpoint", "llave"], probar: ["accion", "endpoint", "llave"] };
  const sobran = Object.keys(x).filter((k) => !permitidas[acc].includes(k));
  if (sobran.length) return { error: `datos no permitidos: ${sobran.slice(0, 3).join(", ")}` };
  if (acc === "alta") {
    if (!b64Largo(x.p256dh, 65) || !b64Largo(x.auth, 16)) return { error: "claves del navegador inválidas" };
    if (x.prueba !== undefined && typeof x.prueba !== "boolean") return { error: "dato de prueba inválido" };
  } else if (typeof x.llave !== "string" || !LLAVE.test(x.llave)) return { error: "llave inválida" };
  if (acc === "alta" || acc === "actualizar") {
    const v = validarPrefs(x.prefs);
    if ("error" in v) return v;
    return { pedido: { ...x, prefs: v.prefs } };
  }
  return { pedido: x };
}
