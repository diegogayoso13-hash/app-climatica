// Tu Faro (Canal Martin Garcia): solo LEE de Supabase (clave publica, sin permiso de escritura).
const SUPABASE_URL = "https://yoxioyszauoaqiwqrpae.supabase.co";
const SUPABASE_KEY = "sb_publishable_vMJL1gkw0u3zBAbJODQNpw_TS0avBJi";
const VIEJO_MIN = 20;              // minutos sin dato para considerar una lectura vieja
const REFRESCO_MS = 2 * 60 * 1000; // se actualiza cada 2 minutos con la app abierta
const TZ = "America/Montevideo";
const raiz = document.getElementById("raiz");

// ---------- lo que se guarda en el celular ----------
const leerLocal = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const guardarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
const DEFECTO = { vAmar: 16, vNar: 22, vRojo: 34, gAmar: 25, gRojo: 34, rioMin: null };
const MARGEN_RIO = 0.2;
let lim = { ...DEFECTO, ...(leerLocal("limites") ?? {}) };
let mareaExtra = leerLocal("marea_extra");
const abiertas = new Set(leerLocal("secciones_abiertas") ?? []); // desplegables que dejaste abiertos
let ultimos = null;     // ultimos datos dibujados
let sinSenal = null;    // hora de los datos guardados, si no hay señal

// ---------- formato ----------
const fH = new Intl.DateTimeFormat("es-UY", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fD = new Intl.DateTimeFormat("es-UY", { timeZone: TZ, weekday: "short", day: "numeric" });
const fDiaClave = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fFH = new Intl.DateTimeFormat("es-UY", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hora = (t) => fH.format(new Date(t));
const fechaHora = (t) => t ? fFH.format(new Date(t)) : "?";
const minDesde = (t) => (Date.now() - new Date(t).getTime()) / 60000;
const hace = (t) => { const m = Math.round(minDesde(t)); if (m < 1) return "recién"; if (m < 60) return `hace ${m} min`; const h = Math.floor(m / 60); return h < 24 ? `hace ${h} h ${m % 60} min` : `hace ${Math.floor(h / 24)} d`; };
const esViejo = (t) => !t || minDesde(t) > VIEJO_MIN;
const n1 = (x) => x == null ? "–" : (Math.round(x * 10) / 10).toLocaleString("es-UY", { useGrouping: false });
const n0 = (x) => x == null ? "–" : String(Math.round(x));
const m2 = (x) => x == null ? "–" : x.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const prom = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

// Direccion: criterio meteorologico (DE DONDE viene el viento). La flecha apunta HACIA DONDE sopla.
const PUNTOS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
const cardinal = (d) => PUNTOS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const dirTexto = (d) => d == null ? "sin dirección" : `de ${cardinal(d)} ${n0(d)}°`;
const dirMedia = (ds, pesos) => {
  if (!ds.length) return null;
  const w = pesos ?? ds.map(() => 1);
  const s = ds.reduce((a, d, i) => a + w[i] * Math.sin(d * Math.PI / 180), 0), c = ds.reduce((a, d, i) => a + w[i] * Math.cos(d * Math.PI / 180), 0);
  return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360;
};

// ---------- iconos de linea, todos del mismo trazo ----------
const IC = {
  flecha: '<path d="M12 21V4M5.5 10.5 12 4l6.5 6.5"/>',
  sube: '<path d="M12 19V5M6 11l6-6 6 6"/>', baja: '<path d="M12 5v14M6 13l6 6 6-6"/>', igual: '<path d="M6 10h12M6 14h12"/>',
  campana: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  engranaje: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  alerta: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  sinSenal: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18"/>',
  tormenta: '<path d="M7 15a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 15"/><path d="M12.5 12 10 16h4l-2.5 4"/>',
  lluvia: '<path d="M7 14a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 14"/><path d="M9 17l-1 3M13 17l-1 3M17 17l-1 3"/>',
  lapiz: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  faro: '<path d="M9.5 6.2 12 4l2.5 2.2z"/><rect x="9.8" y="6.2" width="4.4" height="4.2" rx=".5"/><path d="M8.6 10.4h6.8M10.4 10.4l-1 9.6h5.2l-1-9.6M10 14h4M9.7 17h4.6M8 7.2l-3.5-1.3M8 9.2l-3.5 1.3M16 7.2l3.5-1.3M16 9.2l3.5 1.3"/>',
};
const ic = (n, clase = "ic") => `<svg class="${clase}" viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg>`;
const flecha = (d, clase = "ic") => d == null ? "" : `<svg class="${clase}" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${(d + 180) % 360}deg)">${IC.flecha}</svg>`;
const tend = (a, b, u) => a == null || b == null ? "" : ic(Math.abs(a - b) < u ? "igual" : a > b ? "sube" : "baja", "ic tend");

// ---------- colores ----------
// Tarjeta de Norden y otras estaciones: tus limites del engranaje.
const limV = (v) => v == null ? "" : v >= lim.vRojo ? "lim-rojo" : v >= lim.vNar ? "lim-naranja" : v >= lim.vAmar ? "lim-amarillo" : "lim-verde";
const limG = (g) => g == null ? "" : g >= lim.gRojo ? "lim-rojo" : g >= lim.gAmar ? "lim-amarillo" : "lim-verde";
const limR = (m) => m == null || lim.rioMin == null ? "" : m < lim.rioMin ? "lim-rojo" : m < lim.rioMin + MARGEN_RIO ? "lim-amarillo" : "lim-verde";
// Pronostico: escala Beaufort en nudos (0-3, 4-6, 7-10, 11-16, 17-21, 22-27, 28-33, 34-40, 41+).
const CORTES = [4, 7, 11, 17, 22, 28, 34, 41];
const fuerza = (v) => { const r = Math.round(v); let i = 0; while (i < CORTES.length && r >= CORTES[i]) i++; return i; };
const bf = (v) => v == null ? `<span class="bf f0">–</span>` : `<span class="bf f${fuerza(v)}" style="--fz:${fuerza(v) + 1}">${n0(v)}</span>`;

// ---------- datos ----------
async function api(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { headers: { apikey: SUPABASE_KEY }, cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function bajarTodo() {
  const ahora = new Date().toISOString();
  const hace7d = new Date(Date.now() - 7 * 864e5).toISOString();
  const hace30d = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10);
  const [estaciones, ultimas, pronostico, alertas, fuentes, config, novedades, pdfs, l24, pron6, errores, tramos, vis, armonicos] = await Promise.all([
    api("estaciones?select=*&order=orden"),
    api("ultimas_lecturas?select=*&order=estacion,tipo,ts.desc"),
    api("pronostico_actual?select=*&order=hora"),
    api(`alertas_smn?select=*&toca_zona=is.true&hasta=gt.${encodeURIComponent(ahora)}&order=desde`),
    api("estado_fuentes?select=*"),
    api("configuracion?select=*"),
    api(`novedades_canal?select=*&or=(normalizada_en.is.null,normalizada_en.gt.${encodeURIComponent(hace7d)})&order=km.asc.nullsfirst`),
    api("sohma_pdfs?select=*&order=leido_en.desc&limit=1"),
    api("lecturas_24h?select=estacion,ts,viento_kn,rafaga_kn,marea_m&order=ts"),
    api("pronostico_6h_antes?select=*&order=hora"),
    api(`error_modelos?select=*&anticipacion=eq.0-24&variable=eq.viento&dia=gte.${hace30d}`),
    api("tramos_canal?select=*&order=orden"),
    api("visibilidad_actual?select=modelo,corrida,hora,visibilidad_m&order=hora"),
    api("armonicos?select=estacion,componente,velocidad_gh,coef_cos,coef_sin"),
  ]);
  return { estaciones, ultimas, pronostico, alertas, fuentes, config, novedades, pdfs, l24, pron6, errores, tramos, vis, armonicos };
}
function indexar(ultimas) {
  const ix = {};
  for (const l of ultimas) { ix[l.estacion] ??= {}; (ix[l.estacion][l.tipo] ??= []).push(l); }
  for (const e of Object.values(ix)) for (const t of Object.values(e)) t.sort((a, b) => b.ts.localeCompare(a.ts));
  return ix;
}
// Pronostico por hora: promedio, minimo y maximo de los modelos.
function porHora(filas) {
  const m = new Map();
  for (const f of filas) (m.get(f.hora) ?? m.set(f.hora, []).get(f.hora)).push(f);
  return [...m.entries()].map(([h, fs]) => {
    const vs = fs.map((f) => f.viento_kn).filter((x) => x != null), gs = fs.map((f) => f.rafaga_kn).filter((x) => x != null);
    return { t: new Date(h).getTime(), v: prom(vs), vMin: vs.length ? Math.min(...vs) : null, vMax: vs.length ? Math.max(...vs) : null, g: prom(gs),
      dir: dirMedia(fs.map((f) => f.dir_grados).filter((x) => x != null)),
      tormenta: fs.filter((f) => f.codigo_tiempo >= 95).length, lluvia: prom(fs.map((f) => f.lluvia_mm).filter((x) => x != null)), n: fs.length };
  }).sort((a, b) => a.t - b.t);
}

// ---------- novedades del canal: que ya viste ----------
const claveVista = (n) => `${n.id}|${n.normalizada_en ? "N" + n.normalizada_en : n.primera_vez}`;
const vistas = () => new Set(leerLocal("canal_vistas") ?? []);
const notas = () => leerLocal("notas_senal") ?? {}; // notas propias por señal, NO oficiales
function canalDatos(d) {
  const nov = d.novedades ?? [], ahora = Date.now(), ya = vistas();
  const act = nov.filter((n) => !n.normalizada_en);
  const radio = act.filter((n) => n.tipo === "radioaviso" && (!n.vigente_hasta || new Date(n.vigente_hasta).getTime() > ahora));
  const balizas = act.filter((n) => n.tipo === "baliza");
  const normalizadas = nov.filter((n) => n.normalizada_en);
  const nuevas = new Set([...radio, ...balizas, ...normalizadas].filter((n) => !ya.has(claveVista(n))).map((n) => n.id));
  return { radio, balizas, normalizadas, nuevas, radioNuevo: radio.some((n) => nuevas.has(n.id)) };
}

// ---------- barra de arriba ----------
function barra(d, cd) {
  const carteles = [];
  if (sinSenal) carteles.push(`<div class="cartel rojo">${ic("sinSenal")}<span>Sin señal – mostrando datos guardados de las ${fechaHora(sinSenal)} (${hace(sinSenal)}). Pueden estar viejos.</span></div>`);
  const al = d.alertas ?? [];
  if (al.length) carteles.push(`<button type="button" class="cartel rojo" data-ir="sec-alertas">${ic("alerta")}<span>${al.length === 1 ? "Alerta SMN vigente" : `${al.length} alertas SMN vigentes`}: ${esc([...new Set(al.map((a) => a.evento))].join(", "))}</span><span class="ir">${ic("chev")}</span></button>`);
  const n = cd.nuevas.size;
  if (n) carteles.push(`<button type="button" class="cartel azul" data-ir="sec-canal">${ic("campana")}<span>${n} novedad${n > 1 ? "es" : ""} del canal</span><span class="ir">${ic("chev")}</span></button>`);
  const niebla = nieblaProxima(d.vis);
  if (niebla) carteles.push(`<button type="button" class="cartel rojo" data-ir="sec-pron">${ic("alerta")}<span>Niebla prevista: menos de ${(VIS_ROJO / 1000).toLocaleString("es-UY")} km desde las ${hora(niebla)}</span><span class="ir">${ic("chev")}</span></button>`);
  if (relevNuevo(d)) carteles.push(`<button type="button" class="cartel azul" data-ir="sec-agua">${ic("campana")}<span>La CARP publicó un relevamiento nuevo</span><span class="ir">${ic("chev")}</span></button>`);
  return `<header class="barra"><div class="barra-fila"><div class="marca">${ic("faro")}Tu Faro</div><span class="act">${sinSenal ? "Sin señal" : `Act. ${hora(Date.now())}`}</span><button type="button" class="btn-icono" id="btn-ajustes" aria-label="Ajustes" title="Ajustes">${ic("engranaje")}</button></div>${carteles.join("")}</header>`;
}

// ---------- Norden ----------
function norden(ix, pron6) {
  const [w, wA] = ix.norden?.viento ?? [], [m, mA] = ix.norden?.marea ?? [];
  const viejo = esViejo(w?.ts);
  // Respaldo en un recuadro aparte: Colonia (CARP) y, si tambien esta vieja, Colonia (Armada).
  let respaldo = "";
  if (viejo) {
    const [c] = ix.colonia?.viento ?? [], [a] = ix.colonia_armada?.viento ?? [];
    respaldo = !esViejo(c?.ts) ? `<div class="respaldo"><strong>Respaldo: Colonia (CARP)</strong> · ${hora(c.ts)}<br>${n1(c.viento_kn)} kn · ráfaga ${n1(c.rafaga_kn)} kn · ${flecha(c.dir_grados)} ${dirTexto(c.dir_grados)}</div>`
      : !esViejo(a?.ts) ? `<div class="respaldo"><strong>Respaldo: Colonia (Armada, en tierra, sin ráfagas)</strong> · ${hora(a.ts)}<br>${n1(a.viento_kn)} kn · ${flecha(a.dir_grados)} ${dirTexto(a.dir_grados)}</div>`
      : `<div class="respaldo">Sin respaldo reciente: Colonia (CARP) y Colonia (Armada) también sin dato nuevo.</div>`;
  }
  // Que decia el pronostico (hecho 6 h antes) para la hora de la ultima lectura.
  const ph = porHora(pron6), ref = w && !viejo ? new Date(w.ts).getTime() : Date.now();
  const p = ph.reduce((a, x) => !a || Math.abs(x.t - ref) < Math.abs(a.t - ref) ? x : a, null);
  let comp = "Pronóstico hecho 6 h antes: todavía sin datos para esta hora.";
  if (p && Math.abs(p.t - ref) <= 45 * 60000) {
    const dd = w && !viejo && w.viento_kn != null && p.v != null ? Math.round((w.viento_kn - p.v) * 10) / 10 : null;
    comp = `Pronóstico (hecho 6 h antes) para las ${hora(p.t).slice(0, 2)} h: ${n0(p.v)} kn · ráfaga ${n0(p.g)}${p.dir == null ? "" : ` · de ${cardinal(p.dir)}`}. ` +
      (dd == null ? "<strong>Real:</strong> sin dato nuevo de Norden" : `<strong>Real: ${n1(w.viento_kn)} kn</strong> (${Math.abs(dd) < 0.5 ? "igual a lo pronosticado" : `${n1(Math.abs(dd))} ${dd > 0 ? "más" : "menos"} que lo pronosticado`})`) +
      ` · ${p.n} de 3 modelos`;
  }
  return `<section class="tarjeta">
    <h2 class="titulo">Pilote Norden <span>${w ? `${hora(w.ts)} · ${hace(w.ts)}` : "sin datos de viento"}</span></h2>
    ${viejo ? `<div class="aviso-viejo">${ic("alerta")}Norden sin dato nuevo desde ${w ? `${hora(w.ts)} (${hace(w.ts)})` : "hace mucho"}</div>` : ""}
    <div class="datos ${viejo ? "viejo" : ""}">
      <div class="dato ${viejo ? "" : limV(w?.viento_kn)}"><div class="et">Viento medio</div><div class="val">${n1(w?.viento_kn)}<span class="u">kn</span>${tend(w?.viento_kn, wA?.viento_kn, 0.5)}</div></div>
      <div class="dato ${viejo ? "" : limG(w?.rafaga_kn)}"><div class="et">Ráfaga</div><div class="val">${n1(w?.rafaga_kn)}<span class="u">kn</span>${tend(w?.rafaga_kn, wA?.rafaga_kn, 0.5)}</div></div>
      <div class="dato ancho">${flecha(w?.dir_grados, "ic flecha")}<div><div class="et">Dirección (de dónde viene)</div><div class="val">${w?.dir_grados == null ? "–" : `de ${cardinal(w.dir_grados)}<span class="u">${n0(w.dir_grados)}°</span>`}</div></div></div>
    </div>
    ${respaldo}
    <div class="comparacion">${comp}</div>
    <div class="datos ${esViejo(m?.ts) ? "viejo" : ""}" style="margin-top:10px">
      <div class="dato ancho ${esViejo(m?.ts) ? "" : limR(m?.marea_m)}"><div><div class="et">Altura del río (LIMB)</div><div class="val">${m2(m?.marea_m)}<span class="u">m</span>${tend(m?.marea_m, mA?.marea_m, 0.005)}</div></div>
      <div class="hora-dato">${m ? `${hora(m.ts)}<br>${hace(m.ts)}` : "sin dato"}</div></div>
    </div>
  </section>`;
}

// ---------- agua en el canal ----------
// Agua disponible = profundidad del tramo (CARP, cero LIMB) + marea del tramo.
// Marea del tramo = la MAS BAJA de sus dos estaciones con dato nuevo: si erramos, que muestre menos agua.
const MARGEN_MIN = 0.60;  // REMAGA 2019, art. 2.9: no se puede bajar
const PIE = 0.3048;
const AGUA_DEFECTO = { calado: null, unidad: "m", margen: MARGEN_MIN, colchon: 0.30 };
let aguaAj = { ...AGUA_DEFECTO, ...(leerLocal("agua_canal") ?? {}) };
const caladoM = (aj) => aj.calado == null ? null : aj.unidad === "ft" ? aj.calado * PIE : aj.calado;
const cm = (x) => Math.round(x * 100) / 100; // se compara al centimetro, sin errores de coma flotante
const NOM_CORTO = { norden: "Norden", colonia: "Colonia", conchillas: "Conchillas", carmelo: "Carmelo" };
const kmTxt = (x) => Number(x).toLocaleString("es-UY", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Revisa lo que se carga en el engranaje. Devuelve { error } o { valores }.
function revisarAgua({ calado, unidad, margen, colchon }) {
  const num = (x) => x === "" || x == null ? null : Number(String(x).replace(",", "."));
  const c = num(calado), m = num(margen), k = num(colchon);
  if (c != null && !(c > 0 && c < (unidad === "ft" ? 66 : 20))) return { error: "El calado no parece válido." };
  if (m != null && !(m >= MARGEN_MIN)) return { error: `El margen bajo la quilla no puede ser menor que ${m2(MARGEN_MIN)} m (REMAGA 2019, art. 2.9).` };
  if (k != null && !(k >= 0)) return { error: "El colchón amarillo no puede ser negativo." };
  return { valores: { calado: c, unidad: unidad === "ft" ? "ft" : "m", margen: m ?? AGUA_DEFECTO.margen, colchon: k ?? AGUA_DEFECTO.colchon } };
}

const estadoQuilla = (q, margen, colchon) => q < cm(margen) ? "rojo" : q < cm(margen + colchon) ? "amarillo" : "verde";

function calcularAgua(tramos, ix, aj) {
  const calado = caladoM(aj), margen = Math.max(MARGEN_MIN, aj.margen ?? MARGEN_MIN), colchon = Math.max(0, aj.colchon ?? AGUA_DEFECTO.colchon);
  const filas = tramos.map((t) => {
    const ests = [t.estacion_1, t.estacion_2].map((id) => ({ id, l: (ix[id]?.marea ?? [])[0] }));
    const frescas = ests.filter((e) => e.l && e.l.marea_m != null && !esViejo(e.l.ts));
    const r = { t, ests, frescas, estado: "gris", agua: null, quilla: null, usada: null };
    if (!frescas.length) return r; // sin marea reciente: gris, NUNCA verde
    r.usada = frescas.reduce((a, e) => e.l.marea_m < a.l.marea_m ? e : a);
    r.agua = cm(Number(t.profundidad_m) + r.usada.l.marea_m);
    if (calado == null) { r.estado = "sin-calado"; return r; }
    r.quilla = cm(r.agua - calado);
    r.estado = estadoQuilla(r.quilla, margen, colchon);
    return r;
  });
  const conDato = filas.filter((f) => f.agua != null);
  const critico = conDato.reduce((a, f) => !a || (calado == null ? f.agua < a.agua : f.quilla < a.quilla) ? f : a, null);
  return { filas, critico, calado, margen, colchon, sinMarea: filas.length - conDato.length };
}

// ---------- tendencia proximas 3 h (prediccion propia, NO oficial) ----------
// Marea astronomica de cada estacion (componentes calculadas con el historial de la CARP, cero LIMB)
// + la diferencia de ahora entre lo real y lo astronomico (efecto del viento), que se mantiene 3 h.
// Del lado seguro: a cada hora se le resta el error medido (95 % de las veces fue menor) en 2026.
const ERROR_TENDENCIA = [0.15, 0.25, 0.35]; // metros, a 1, 2 y 3 h. Para cambiarlos, tocar solo aca.
const T0_ARMONICOS = Date.UTC(2020, 0, 1, 3); // 2020-01-01 00:00 hora de Uruguay
function astroDe(filas) {
  const por = {};
  for (const f of filas ?? []) (por[f.estacion] ??= []).push(f);
  return (est, t) => {
    const cs = por[est];
    if (!cs?.length) return null;
    const x = (new Date(t).getTime() - T0_ARMONICOS) / 3600e3;
    return cs.reduce((s, c) => { const a = c.velocidad_gh * x * Math.PI / 180; return s + c.coef_cos * Math.cos(a) + c.coef_sin * Math.sin(a); }, 0);
  };
}
function tendenciaAgua(tramos, ix, aj, astro, ahora = Date.now()) {
  const c = calcularAgua(tramos, ix, aj);
  for (const f of c.filas) {
    const ests = f.frescas.filter((e) => astro(e.id, e.l.ts) != null);
    f.tend = null; f.estsTend = ests;
    if (!ests.length) continue;
    f.tend = ERROR_TENDENCIA.map((err, i) => {
      const t = ahora + (i + 1) * 3600e3;
      const pred = ests.map((e) => { const central = astro(e.id, t) + (e.l.marea_m - astro(e.id, e.l.ts)); return { id: e.id, central, seguro: central - err }; });
      const mSeg = Math.min(...pred.map((p) => p.seguro)), mCen = Math.min(...pred.map((p) => p.central));
      const agua = cm(Number(f.t.profundidad_m) + mSeg), aguaCentral = cm(Number(f.t.profundidad_m) + mCen);
      const quilla = c.calado == null ? null : cm(agua - c.calado);
      const dif = f.agua == null ? 0 : aguaCentral - f.agua;
      return { h: i + 1, t, err, agua, quilla, estado: quilla == null ? "sin-calado" : estadoQuilla(quilla, c.margen, c.colchon),
        flecha: dif > 0.05 ? "sube" : dif < -0.05 ? "baja" : "igual" };
    });
  }
  // Si en alguna hora otro tramo queda con menos agua que el critico de ahora, se avisa (la primera vez).
  const val = (x) => c.calado == null ? x.agua : x.quilla;
  c.aviso = null;
  if (c.critico?.tend) for (let i = 0; i < ERROR_TENDENCIA.length && !c.aviso; i++) {
    const otros = c.filas.filter((f) => f !== c.critico && f.tend).map((f) => ({ f, x: f.tend[i] }));
    const peor = otros.reduce((a, o) => !a || val(o.x) < val(a.x) ? o : a, null);
    if (peor && val(peor.x) < val(c.critico.tend[i])) c.aviso = { h: i + 1, t: peor.f.t, x: peor.x };
  }
  return c;
}
const FLECHA = { sube: "↑ sube", baja: "↓ baja", igual: "= igual" };
function tendenciaHtml(c, nom) {
  const f = c.critico;
  if (!f) return "";
  const sinCal = c.calado == null;
  if (!f.tend) return `<div class="tendencia"><div class="tend-tit">Tendencia próximas 3 h</div><p class="nota" style="margin:0">Sin tendencia: falta marea reciente o las componentes de marea de ${esc(f.frescas.map((e) => nom(e.id)).join(" y ") || "sus estaciones")}.</p></div>`;
  const celda = (x, campo) => `<td class="${sinCal ? "" : CLASE[x.estado] ?? ""}"><span class="tv">${m2(x[campo])}</span></td>`;
  const reales = f.estsTend.map((e) => `${nom(e.id)} ${hora(e.l.ts)}`).join(" y ");
  const avisoTxt = c.aviso ? `<div class="tend-aviso">${ic("alerta")}<span>En ${c.aviso.h} h el tramo con menos agua pasa a ser <strong>${esc(c.aviso.t.nombre)}</strong>: ${m2(c.aviso.x.agua)} m${sinCal ? "" : ` · ${m2(c.aviso.x.quilla)} m bajo la quilla`}</span></div>` : "";
  return `<div class="tendencia">
    <div class="tend-tit">Tendencia próximas 3 h · ${esc(f.t.nombre)}</div>
    <table class="tend-tabla"><tr><th></th><th>ahora</th>${f.tend.map((x) => `<th>en ${x.h} h<small>${hora(x.t)}</small></th>`).join("")}</tr>
      <tr><th>agua</th><td class="${sinCal ? "" : CLASE[f.estado] ?? ""}"><span class="tv">${m2(f.agua)}</span></td>${f.tend.map((x) => celda(x, "agua")).join("")}</tr>
      ${sinCal ? "" : `<tr><th>quilla</th><td class="${CLASE[f.estado] ?? ""}"><span class="tv">${m2(f.quilla)}</span></td>${f.tend.map((x) => celda(x, "quilla")).join("")}</tr>`}
      <tr class="tend-flecha"><th></th><td></td>${f.tend.map((x) => `<td>${FLECHA[x.flecha]}</td>`).join("")}</tr></table>
    ${avisoTxt}
    <p class="nota">Del lado seguro: predicción menos el error medido (${ERROR_TENDENCIA.map((e) => m2(e)).join(" / ")} m). Predicción propia: marea astronómica de la CARP corregida con lo real de ${reales}${f.estsTend.length === 1 ? " (con una sola estación)" : ""}. No es oficial.</p>
  </div>`;
}

const ultimoCambioCarp = (d) => (d?.tramos ?? []).map((t) => t.cambio_carp_en).filter(Boolean).sort().pop() ?? null;
const relevNuevo = (d) => { const u = ultimoCambioCarp(d); return u && leerLocal("relevamiento_visto") !== u; };
const CLASE = { rojo: "lim-rojo", amarillo: "lim-amarillo", verde: "lim-verde" };
const IC_ROCA = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19l4.5-8 3.5 3 3.5-6.5L21 19z"/></svg>';
const IC_NATURAL = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>';

function aguaSec(d, ix, aj) {
  const tramos = d.tramos ?? [];
  if (!tramos.length) return `<section class="tarjeta" id="sec-agua"><h2 class="titulo">Agua en el canal</h2><p class="nota" style="margin:0">Todavía no está la tabla de tramos de la CARP.</p></section>`;
  const c = tendenciaAgua(tramos, ix, aj, d.astro ?? astroDe(d.armonicos));
  const nom = (id) => NOM_CORTO[id] ?? id;
  const sinCal = c.calado == null;

  let cab;
  if (!c.critico) cab = `<div class="critico">${ic("alerta")}<span>Sin marea reciente en ninguna estación: no se puede calcular el agua.</span></div>`;
  else {
    const f = c.critico;
    const quilla = sinCal ? "" : f.quilla < 0 ? ` · <strong>el calado supera el agua por ${m2(-f.quilla)} m</strong>` : ` · quedan ${m2(f.quilla)} m bajo la quilla`;
    cab = `<div class="critico ${sinCal ? "" : CLASE[f.estado]}"><span>Tramo crítico: <strong>${esc(f.t.nombre)}</strong> · ${m2(f.agua)} m de agua${quilla}${c.sinMarea ? ` <small>(${c.sinMarea} tramo${c.sinMarea > 1 ? "s" : ""} sin marea)</small>` : ""}</span></div>`;
  }

  const filas = c.filas.map((f) => {
    const t = f.t, gris = f.estado === "gris";
    const iconos = [t.tiene_roca ? `<span class="marca-t">${IC_ROCA}roca km ${esc(t.roca_km)}</span>` : "",
      t.prof_natural ? `<span class="marca-t">${IC_NATURAL}prof. natural${Number(t.natural_desde_km) > Number(t.km_desde) ? ` desde km ${kmTxt(t.natural_desde_km)}` : ""}</span>` : ""].join("");
    let est;
    if (gris) est = `${nom(t.estacion_1)} y ${nom(t.estacion_2)} sin dato nuevo de marea`;
    else if (f.frescas.length === 1) {
      const otra = f.ests.find((e) => e.id !== f.usada.id);
      est = `con una sola estación: ${nom(f.usada.id)} ${m2(f.usada.l.marea_m)} m (${nom(otra.id)} sin dato nuevo)`;
    } else {
      const otra = f.frescas.find((e) => e !== f.usada);
      est = `marea ${nom(f.usada.id)} ${m2(f.usada.l.marea_m)} m (la más baja; ${nom(otra.id)} ${m2(otra.l.marea_m)})`;
    }
    return `<div class="tramo ${CLASE[f.estado] ?? ""} ${gris ? "gris" : ""} ${f === c.critico ? "es-critico" : ""}">
      <div class="tr-nom"><span class="tr-n">${esc(t.nombre)}</span><small>km ${kmTxt(t.km_desde)}–${kmTxt(t.km_hasta)} · prof. ${m2(Number(t.profundidad_m))} m</small>${iconos ? `<small class="marcas">${iconos}</small>` : ""}<small class="${f.frescas.length === 1 ? "una" : ""}">${est}</small></div>
      <div class="tr-val"><span class="tr-agua">${gris ? "–" : m2(f.agua)}<span class="u">m</span></span><small>agua</small></div>
      ${sinCal ? "" : `<div class="tr-val"><span class="tr-quilla">${gris ? "–" : m2(f.quilla)}<span class="u">m</span></span><small>${gris ? "sin marea" : "bajo quilla"}</small></div>`}
    </div>`;
  }).join("");

  // Hora de cada marea usada (solo las que tienen dato nuevo).
  const usadas = [...new Set(tramos.flatMap((t) => [t.estacion_1, t.estacion_2]))].map((id) => {
    const l = (ix[id]?.marea ?? [])[0];
    return `${nom(id)} ${l ? `${hora(l.ts)}${esViejo(l.ts) ? " (vieja, no se usa)" : ""}` : "sin dato"}`;
  }).join(" · ");
  const relevs = [...new Set(tramos.map((t) => t.relevamiento))].join(", ");
  const resumen = sinCal ? "sin calado" : `calado ${m2(c.calado)} m${aj.unidad === "ft" ? ` (${n1(aj.calado)} ft)` : ""} · margen ${m2(c.margen)}`;

  return `<section class="tarjeta" id="sec-agua">
    <h2 class="titulo">Agua en el canal <span>${resumen}</span></h2>
    ${relevNuevo(d) ? `<div class="ya-lo-vi"><span class="nota" style="margin:0"><strong>La CARP publicó un relevamiento nuevo</strong> (${esc(relevs)}). La tabla ya está actualizada.</span><button type="button" class="primario" id="btn-relev-visto">Visto</button></div>` : ""}
    ${cab}
    ${tendenciaHtml(c, nom)}
    ${sinCal ? `<button type="button" class="cargar-calado" data-abrir-ajustes="1">${ic("engranaje")}Cargá tu calado en el engranaje</button>` : ""}
    <div class="tramos">${filas}</div>
    ${sinCal ? "" : `<p class="nota">Rojo: quedan menos de ${m2(c.margen)} m bajo la quilla. Amarillo: entre ${m2(c.margen)} y ${m2(c.margen + c.colchon)} m. Verde: más de ${m2(c.margen + c.colchon)} m. Gris: sin marea reciente.</p>`}
    <p class="nota">Relevamiento CARP: <strong>${esc(relevs)}</strong> (cero LIMB) · Marea usada: ${usadas}</p>
    <p class="nota leyenda-agua">Referencia, no reemplaza al práctico ni a la información oficial. Calcula con el calado del buque detenido: navegando, el buque se hunde un poco más (squat).</p>
  </section>`;
}

// ---------- visibilidad pronosticada (Open-Meteo: ECMWF 9 km y GFS) ----------
// Limites del REMAGA 2019. Para cambiarlos, tocar solo estos dos numeros (en metros).
const VIS_ROJO = 1000;     // art. 2.7.3: minimo para iniciar la navegacion
const VIS_AMARILLO = 8000; // Tabla II: limite para buques grandes
const claseVis = (m) => m == null ? "" : m < VIS_ROJO ? "vis-rojo" : m < VIS_AMARILLO ? "vis-amarillo" : "";
const fmtVis = (m) => m == null ? "s/d" : m < 1000 ? `${Math.round(m / 10) * 10} m`
  : m < 10000 ? (Math.floor(m / 100) / 10).toLocaleString("es-UY") : String(Math.floor(m / 1000));
const chipVis = (m) => `<span class="vis ${claseVis(m)}">${fmtVis(m)}</span>`;
// Por hora, el valor MAS BAJO de los modelos que tengan dato (errar del lado seguro).
function visMapa(filas) {
  const m = new Map();
  for (const f of filas ?? []) {
    if (f.visibilidad_m == null) continue;
    const t = new Date(f.hora).getTime(), a = m.get(t);
    m.set(t, a == null ? f.visibilidad_m : Math.min(a, f.visibilidad_m));
  }
  return m;
}
// Primera hora con menos de VIS_ROJO en las proximas 12 h (para el cartel de arriba).
function nieblaProxima(filas) {
  const ahora = Date.now();
  return [...visMapa(filas).entries()].filter(([t, v]) => t >= ahora - 30 * 60000 && t <= ahora + 12 * 3600e3 && v < VIS_ROJO)
    .map(([t]) => t).sort((a, b) => a - b)[0] ?? null;
}

// ---------- pronostico ----------
const columna = (p, nuevoDia) => `<div class="col ${nuevoDia ? "nuevo-dia" : ""}">
    <div class="h">${hora(p.t).slice(0, 2)}h</div>${bf(p.v)}<div class="g">${n0(p.g)}</div>
    <div class="dir">${flecha(p.dir)}${p.dir == null ? "" : cardinal(p.dir)}</div>
    <div class="tor" title="${p.tormenta ? `${p.tormenta} de ${p.n} modelos dan tormenta` : ""}">${p.tormenta ? ic("tormenta") : p.lluvia >= 0.5 ? ic("lluvia") : ""}</div>
    ${chipVis(p.vis)}</div>`;
const cabecera = `<div class="col cab"><div class="h">hora</div><div style="min-height:27px;display:grid;align-items:center">viento</div><div class="g">ráfaga</div><div class="dir" style="min-height:34px">de</div><div class="tor"></div><div class="vis-cab">visib.<br>km</div></div>`;
function pronostico(filas, config, vis) {
  const punto = config?.find((c) => c.clave === "punto_pronostico")?.valor;
  const vm = visMapa(vis);
  const ph = porHora(filas).filter((p) => p.t >= Date.now() - 3600e3).map((p) => ({ ...p, vis: vm.get(p.t) ?? null }));
  if (!ph.length) return `<section class="tarjeta"><h2 class="titulo">Pronóstico</h2><p class="nota">Sin pronóstico disponible.</p></section>`;
  const prox = ph.slice(0, 24);
  const dias = new Map();
  const hoy = fDiaClave.format(new Date());
  for (const p of ph) { const k = fDiaClave.format(new Date(p.t)); if (k !== hoy) (dias.get(k) ?? dias.set(k, []).get(k)).push(p); }
  // Renglones por dia desde manana (hoy ya esta en la tira de 24 h), cerrados de entrada.
  const filasDia = [...dias.entries()].slice(0, 4).map(([k, hs], i) => {
    const vMax = Math.max(...hs.map((p) => p.v ?? 0)), gMax = Math.max(...hs.map((p) => p.g ?? 0));
    const conDir = hs.filter((p) => p.dir != null);
    const dir = dirMedia(conDir.map((p) => p.dir), conDir.map((p) => p.v ?? 1)); // predominante, pesada por el viento
    const tor = hs.some((p) => p.tormenta);
    const vs = hs.map((p) => p.vis).filter((x) => x != null), vMin = vs.length ? Math.min(...vs) : null;
    return `<details class="dia" data-clave="dia-${k}"><summary>
      <span class="nom">${i === 0 ? "Mañana" : esc(fD.format(new Date(hs[0].t)))}${hs.length < 20 ? `<small>hasta ${hora(hs.at(-1).t).slice(0, 2)} h</small>` : ""}</span>
      ${bf(vMax)}<span class="raf">r ${n0(gMax)}</span>
      <span class="dd">${flecha(dir)}${dir == null ? "" : cardinal(dir)}</span>
      <span class="vis-dia" title="visibilidad mínima del día">${vMin != null && vMin >= 1000 ? `<small>vis</small> ` : ""}${chipVis(vMin)}</span>
      <span>${tor ? `<span style="color:var(--l-amarillo)" title="tormenta">${ic("tormenta")}</span>` : ""}</span>
      <span class="chev">${ic("chev")}</span></summary>
      <div class="tira">${cabecera}${hs.map((p) => columna(p)).join("")}</div></details>`;
  }).join("");
  const modelos = [...new Set(filas.map((f) => f.modelo))].sort();
  const corridas = modelos.map((mo) => { const c = filas.find((f) => f.modelo === mo)?.corrida; return `${mo.toUpperCase()} ${c ? fechaHora(c) : "?"}`; });
  let diaAnt = fDiaClave.format(new Date(prox[0].t));
  const sinVis = !prox.some((p) => p.vis != null);
  // De que corrida sale la visibilidad: si Open-Meteo no respondio, puede ser vieja (gris si tiene mas de 12 h).
  const corrVis = [...new Set((vis ?? []).map((f) => f.modelo))].sort().map((mo) => {
    const c = (vis ?? []).filter((f) => f.modelo === mo).map((f) => f.corrida).sort().pop();
    const vieja = minDesde(c) > 12 * 60;
    return `<span class="${vieja ? "corrida-vieja" : "corrida-ok"}">${mo === "ecmwf" ? "ECMWF" : mo.toUpperCase()}: corrida de las ${hora(c)}${fDiaClave.format(new Date(c)) !== fDiaClave.format(new Date()) ? ` del ${fD.format(new Date(c))}` : ""}${vieja ? " (más de 12 h)" : ""}</span>`;
  }).join(" · ");
  return `<section class="tarjeta" id="sec-pron">
    <h2 class="titulo">Pronóstico <span>próximas 24 h · ${esc(punto?.nombre ?? "Norden")}</span></h2>
    <div class="tira">${cabecera}${prox.map((p) => { const k = fDiaClave.format(new Date(p.t)); const n = k !== diaAnt; diaAnt = k; return columna(p, n); }).join("")}</div>
    <p class="nota nota-vis">${sinVis ? "<strong>Visibilidad: sin dato.</strong> " : ""}Visibilidad pronosticada (Open-Meteo). No hay medición real en el canal. Rojo: menos de ${VIS_ROJO.toLocaleString("es-UY")} m; amarillo: menos de ${VIS_AMARILLO / 1000} km.${corrVis ? ` ${corrVis}.` : ""}</p>
    <div class="dias">${filasDia}</div>
    <p class="nota">Promedio de los modelos (${corridas.join(" · ")}). En cada día: viento y ráfaga máximos en nudos, dirección predominante y visibilidad mínima. Tocá un día para verlo hora por hora. Visibilidad: el valor más bajo entre ECMWF (9 km) y GFS.</p>
  </section>`;
}

// ---------- grafico de lineas en SVG (sin librerias) ----------
const graficos = {};
function grafico(id, lecturaId, { series, banda, zonas = [], t0, t1, fmtV, H = 190 }) {
  const G = { W: 360, H, iz: 34, de: 8, ar: 8, ab: 22 };
  const todos = series.flatMap((s) => s.puntos.map((p) => p[1])).concat(banda ? banda.flatMap((p) => [p[1], p[2]]) : []).filter((x) => x != null);
  if (!todos.length) return `<p class="nota">Sin datos en las últimas 24 h.</p>`;
  // La escala incluye el limite de las zonas (tu minimo del rio) para que se vea la linea de corte.
  const lims = zonas.flatMap((z) => [z.y0, z.y1]).filter((x) => x != null);
  let y0 = Math.min(...todos, ...lims), y1 = Math.max(...todos, ...lims);
  const pad = Math.max((y1 - y0) * 0.1, 0.05); y0 -= pad; y1 += pad;
  const X = (t) => G.iz + (t - t0) / (t1 - t0) * (G.W - G.iz - G.de), Y = (v) => G.ar + (1 - (v - y0) / (y1 - y0)) * (G.H - G.ar - G.ab);
  const camino = (pts, cortar) => { let d = "", a = null; for (const [t, v] of pts) { if (v == null) { a = null; continue; } d += `${a == null || t - a > cortar ? "M" : "L"}${X(t).toFixed(1)},${Y(v).toFixed(1)}`; a = t; } return d; };
  let s = `<svg viewBox="0 0 ${G.W} ${G.H}" role="img" aria-label="gráfico" data-graf="${id}">`;
  for (const z of zonas) { const a = Math.max(z.y0 ?? y0, y0), b = Math.min(z.y1 ?? y1, y1); if (b > a) s += `<rect x="${G.iz}" width="${G.W - G.iz - G.de}" y="${Y(b)}" height="${Y(a) - Y(b)}" style="fill:${z.relleno}"/>`; }
  const bruto = (y1 - y0) / 4, pot = 10 ** Math.floor(Math.log10(bruto)), paso = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((k) => k >= bruto);
  for (let v = Math.ceil(y0 / paso) * paso; v <= y1; v += paso) s += `<line class="eje" x1="${G.iz}" x2="${G.W - G.de}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${G.iz - 4}" y="${Y(v) + 3}" text-anchor="end">${fmtV(Math.round(v / paso) * paso + 0)}</text>`;
  for (let t = Math.ceil(t0 / 108e5) * 108e5; t <= t1; t += 108e5) s += `<text x="${X(t)}" y="${G.H - 6}" text-anchor="middle">${hora(t).slice(0, 2)}h</text>`;
  if (banda?.length) s += `<polygon points="${banda.map(([t, , hi]) => `${X(t).toFixed(1)},${Y(hi).toFixed(1)}`).concat(banda.slice().reverse().map(([t, lo]) => `${X(t).toFixed(1)},${Y(lo).toFixed(1)}`)).join(" ")}" style="fill:var(--serie2);opacity:.18"/>`;
  for (const se of series) s += `<path d="${camino(se.puntos, se.cortarMin * 60000)}" fill="none" style="stroke:${se.color};stroke-width:${se.ancho ?? 2};stroke-linecap:round;stroke-linejoin:round${se.punteada ? ";stroke-dasharray:5 4" : ""}"/>`;
  s += `<line class="cruz" x1="0" x2="0" y1="${G.ar}" y2="${G.H - G.ab}" style="display:none"/></svg>`;
  graficos[id] = { series, t0, t1, X, G, fmtV, lecturaId };
  return s;
}
// Lectura al tocar o pasar el dedo: el valor mas cercano de cada serie.
function tocarGrafico(ev) {
  const el = ev.target.closest?.("svg[data-graf]"); if (!el) return;
  const g = graficos[el.dataset.graf], r = el.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width * g.G.W, t = g.t0 + (x - g.G.iz) / (g.G.W - g.G.iz - g.G.de) * (g.t1 - g.t0);
  if (t < g.t0 || t > g.t1) return;
  const cruz = el.querySelector(".cruz"); cruz.setAttribute("x1", g.X(t)); cruz.setAttribute("x2", g.X(t)); cruz.style.display = "";
  document.getElementById(g.lecturaId).textContent = g.series.map((s) => {
    let b = null; for (const p of s.puntos) if (p[1] != null && (!b || Math.abs(p[0] - t) < Math.abs(b[0] - t))) b = p;
    return b && Math.abs(b[0] - t) < s.cortarMin * 60000 ? `${s.nombre} ${g.fmtV(b[1])} (${hora(b[0])})` : `${s.nombre} sin dato`;
  }).join(" · ");
}

// ---------- marea 24 h ----------
const EST_MAREA = { colonia: "Colonia", conchillas: "Conchillas", carmelo: "Carmelo" };
function marea(l24) {
  const t1 = Date.now(), t0 = t1 - 864e5;
  const serie = (id) => l24.filter((l) => l.estacion === id && l.marea_m != null).map((l) => [new Date(l.ts).getTime(), l.marea_m]);
  const series = [{ nombre: "Norden", puntos: serie("norden"), color: "var(--acento)", ancho: 2.5, cortarMin: 20 }];
  if (mareaExtra) series.push({ nombre: EST_MAREA[mareaExtra], puntos: serie(mareaExtra), color: "var(--serie2)", ancho: 1.5, punteada: true, cortarMin: 20 });
  const zonas = lim.rioMin == null ? [] : [
    { y0: null, y1: lim.rioMin, relleno: "color-mix(in srgb, var(--l-rojo) 16%, transparent)" },
    { y0: lim.rioMin, y1: lim.rioMin + MARGEN_RIO, relleno: "color-mix(in srgb, var(--l-amarillo) 16%, transparent)" }];
  return `<section class="tarjeta" id="sec-marea">
    <h2 class="titulo">Marea últimas 24 h <span>m sobre LIMB</span></h2>
    <div class="botonera">${Object.entries(EST_MAREA).map(([id, n]) => `<button type="button" data-marea="${id}" aria-pressed="${mareaExtra === id}">+ ${n}</button>`).join("")}</div>
    <div class="lectura" id="lec-marea">Tocá el gráfico para ver cada valor.</div>
    <div class="grafico">${grafico("marea", "lec-marea", { series, zonas, t0, t1, fmtV: m2, H: 140 })}</div>
    <div class="leyenda"><span><i style="background:var(--acento)"></i>Norden</span>${mareaExtra ? `<span><i style="background:var(--serie2)"></i>${EST_MAREA[mareaExtra]} (punteada)</span>` : ""}${lim.rioMin != null ? `<span>Rojo: debajo de tu mínimo (${m2(lim.rioMin)} m) · amarillo: hasta +0,2 m</span>` : ""}<span>Línea cortada = sin datos</span></div>
  </section>`;
}

// ---------- otras estaciones ----------
function otras(ix, nombre) {
  const filas = ["colonia", "conchillas", "carmelo"].map((id) => {
    const [w, wA] = ix[id]?.viento ?? [], [m, mA] = ix[id]?.marea ?? [];
    const vv = esViejo(w?.ts), mv = esViejo(m?.ts);
    return `<details class="fila ${vv ? "viejo" : ""}" data-clave="fila-${id}"><summary>
      <span class="nombre">${esc(nombre[id] ?? id)}<small>${w ? `${hora(w.ts)} · ${hace(w.ts)}` : "sin viento"}</small></span>
      <span class="v ${vv ? "" : limV(w?.viento_kn)}">${n0(w?.viento_kn)}<small> kn</small></span>
      <span class="r ${vv ? "" : limG(w?.rafaga_kn)}" style="color:var(--num, var(--suave))">r ${n0(w?.rafaga_kn)}</span>
      <span class="m ${mv ? "" : limR(m?.marea_m)}" style="color:var(--num, var(--texto))">${flecha(w?.dir_grados)}${m2(m?.marea_m)}<small style="color:var(--suave)">m</small></span></summary>
      <div class="detalle">Viento ${n1(w?.viento_kn)} kn${tend(w?.viento_kn, wA?.viento_kn, 0.5)} · ráfaga ${n1(w?.rafaga_kn)} kn · ${dirTexto(w?.dir_grados)} — ${w ? `${hora(w.ts)} (${hace(w.ts)})` : "sin dato"}<br>
      Marea ${m2(m?.marea_m)} m${tend(m?.marea_m, mA?.marea_m, 0.005)} — ${m ? `${hora(m.ts)} (${hace(m.ts)})` : "sin dato"}${vv || mv ? `<br><strong>Dato viejo (más de ${VIEJO_MIN} min).</strong>` : ""}</div></details>`;
  }).join("");
  const [a, aA] = ix.colonia_armada?.ambiente ?? [], [wa] = ix.colonia_armada?.viento ?? [];
  const av = esViejo(a?.ts);
  const armada = `<details class="fila ${av ? "viejo" : ""}" data-clave="fila-armada"><summary>
    <span class="nombre">Colonia (Armada)<small>en tierra · ${a ? `${hora(a.ts)} · ${hace(a.ts)}` : "sin dato"}</small></span>
    <span class="v ${esViejo(wa?.ts) ? "" : limV(wa?.viento_kn)}">${n0(wa?.viento_kn)}<small> kn</small></span><span class="r">${n1(a?.temp_c)}°</span>
    <span class="m" style="font-size:.85rem">${n0(a?.presion_hpa)}<small style="color:var(--suave)">hPa</small></span></summary>
    <div class="detalle">Presión ${n1(a?.presion_hpa)} hPa${tend(a?.presion_hpa, aA?.presion_hpa, 0.2)} · temperatura ${n1(a?.temp_c)} °C · humedad ${n0(a?.humedad_pct)} %<br>
    Viento ${n1(wa?.viento_kn)} kn · ${dirTexto(wa?.dir_grados)} (sin ráfagas) — ${a ? `${hora(a.ts)} (${hace(a.ts)})` : "sin dato"}</div></details>`;
  return `<section class="tarjeta"><h2 class="titulo">Otras estaciones <span>viento · ráfaga · marea</span></h2>${filas}${armada}</section>`;
}

// ---------- desplegables (cerrados de entrada; recuerda cuales dejaste abiertos) ----------
const plegable = (id, titulo, resumen, cuerpo, { forzarAbierta = false, marcada = false } = {}) =>
  `<details class="tarjeta plegable ${marcada ? "marcada" : ""}" id="${id}" ${forzarAbierta || abiertas.has(id) ? "open" : ""}><summary>
    <h2 class="titulo">${titulo}</h2><span class="res">${resumen}</span><span class="chev">${ic("chev")}</span></summary><div class="cuerpo">${cuerpo}</div></details>`;

const TRAMOS = { "BARRA DEL FARALLON": "Barra del Farallón", "PASO DEL FARALLON": "Paso del Farallón", "BARRA DE SAN PEDRO": "Barra de San Pedro", "PASO DE SAN JUAN": "Paso de San Juan", "POZOS DE SAN JUAN": "Pozos de San Juan", "CANAL NUEVO": "Canal Nuevo", "CANAL DEL INFIERNO": "Canal del Infierno", "CANAL DEL ESTE": "Canal del Este", "CANAL PRINCIPAL": "Canal Principal", "CANAL INTERMEDIO": "Canal Intermedio (otro kilometraje)" };
const tramoLindo = (t) => TRAMOS[t] ?? (t ? t.charAt(0) + t.slice(1).toLowerCase() : "");
// Estados: falta rojo; corrida/averiada naranja; apagada/luz no confiable amarillo; normalizada verde.
const colorEstado = (e = "") => /FALTA|HUNDIDA|DESTRUIDA/.test(e) ? "e-rojo" : /CORRIDA|AVERIADA|RETIRADA|REPOSICIONADA/.test(e) ? "e-naranja" : /APAGADA|NO CONFIABLE|AIS|TOPE/.test(e) ? "e-amarillo" : "e-gris";

function canal(d, cd) {
  const pdf = (d.pdfs ?? [])[0], sohma = (d.fuentes ?? []).find((f) => f.fuente === "sohma");
  const misNotas = notas();
  const nuevo = (n) => cd.nuevas.has(n.id) ? `<span class="etq e-nuevo">NUEVO</span> ` : "";
  const avisos = [];
  if (!pdf) avisos.push("Todavía no se leyó ningún PDF del SOHMA.");
  else {
    if (!pdf.ok) avisos.push(`El PDF del SOHMA (${esc(pdf.archivo)}) no se pudo leer bien: se muestran las últimas novedades que sí se leyeron.`);
    for (const p of pdf.problemas ?? []) if (/MENCIONAR EL CANAL/.test(p)) avisos.push(esc(p));
  }
  if (sohma?.ultimo_error && (!sohma.ultimo_ok || sohma.ultimo_error > sohma.ultimo_ok)) avisos.push(`Error al revisar el SOHMA: ${esc(sohma.mensaje_error)}`);
  if (sohma?.ultimo_ok && minDesde(sohma.ultimo_ok) > 26 * 60) avisos.push(`El robot no pudo revisar el SOHMA desde ${fechaHora(sohma.ultimo_ok)}.`);

  const fila = (n, esNorm) => `<div class="baliza"><span class="km">${n.km != null ? `km ${String(n.km).replace(".", ",")}` : "–"}</span>
    <span>${nuevo(n)}Nº ${esc(n.clave)} · ${esc((n.descripcion ?? "").replace(/\s*KM\s*[\d.,]+/i, "").toLowerCase())}<small>${esc(tramoLindo(n.tramo))} · ${esNorm ? `normalizada ${fechaHora(n.normalizada_en)}` : `visto desde ${fechaHora(n.primera_vez)}`}</small></span>
    <span class="etq ${esNorm ? "e-verde" : colorEstado(n.estado)}">${esNorm ? "NORMALIZADA" : esc(n.estado)}</span>
    <span class="nota-mia">${misNotas[n.clave]
      ? `<strong>Tu nota</strong> (${fechaHora(misNotas[n.clave].fecha)}, no oficial): ${esc(misNotas[n.clave].texto)} <button type="button" class="btn-nota" data-nota="${esc(n.clave)}">${ic("lapiz")}editar</button>`
      : `<button type="button" class="btn-nota" data-nota="${esc(n.clave)}">${ic("lapiz")}agregar nota</button>`}</span></div>`;

  const cuerpo = `${cd.nuevas.size ? `<div class="ya-lo-vi"><span class="nota" style="margin:0">Hay ${cd.nuevas.size} novedad${cd.nuevas.size > 1 ? "es" : ""} desde tu última visita (marcadas NUEVO).</span><button type="button" class="primario" id="btn-visto">Ya lo vi</button></div>` : ""}
    ${avisos.map((a) => `<div class="aviso-int">${a}</div>`).join("")}
    <p class="nota" style="margin-top:0">${pdf ? `Balizamiento: aviso del ${esc(pdf.lista_emitido ?? "?")}, vigente hasta ${pdf.lista_vigente_hasta ? fechaHora(pdf.lista_vigente_hasta) : "?"} · PDF ${esc(pdf.archivo)} leído ${fechaHora(pdf.leido_en)}` : ""}</p>
    <h3 class="sub">Radioavisos</h3>${cd.radio.length ? cd.radio.map((n) => `<details class="radioaviso" data-clave="avur-${esc(n.clave)}" ${cd.nuevas.has(n.id) ? "open" : ""}><summary>${nuevo(n)}AVUR ${esc(n.clave)} · ${esc((n.descripcion ?? "").replace(/^CANALES A MARTIN GARCIA · /, "").toLowerCase())}</summary><p>${esc(n.texto)}</p><p class="nota">Emitido ${esc(n.emitido ?? "?")}${n.anula ? ` · anula ${esc(n.anula)}` : ""} · hasta ${fechaHora(n.vigente_hasta)} · visto desde ${fechaHora(n.primera_vez)}</p></details>`).join("") : `<p class="nota" style="margin-top:0">Sin radioavisos vigentes para el canal.</p>`}
    <h3 class="sub">Balizamiento (${cd.balizas.length})</h3>${cd.balizas.map((n) => fila(n)).join("") || `<p class="nota" style="margin-top:0">Sin novedades de balizamiento en el canal.</p>`}
    <h3 class="sub">Normalizadas en los últimos 7 días</h3>${cd.normalizadas.map((n) => fila(n, true)).join("") || `<p class="nota" style="margin-top:0">Ninguna.</p>`}
    <p class="nota">"Visto desde": primer día que el robot lo vio en los avisos del SOHMA (el SOHMA no informa desde cuándo está cada novedad). Las notas son tuyas y quedan solo en este celular.</p>`;
  const res = `${cd.nuevas.size ? '<span class="punto"></span> ' : ""}${cd.radio.length} radioaviso${cd.radio.length === 1 ? "" : "s"} · ${cd.balizas.length} baliza${cd.balizas.length === 1 ? "" : "s"}`;
  // Radioaviso nuevo sin ver: se abre sola y queda marcada hasta "Ya lo vi".
  return plegable("sec-canal", "Canal Martín García", res, cuerpo, { forzarAbierta: cd.radioNuevo, marcada: cd.radioNuevo });
}

const SEVERIDAD = { Minor: ["menor", "--l-amarillo"], Moderate: ["moderada", "--l-amarillo"], Severe: ["severa", "--l-naranja"], Extreme: ["extrema", "--l-rojo"] };
function alertasSec(d) {
  const al = d.alertas ?? [], smn = (d.fuentes ?? []).find((f) => f.fuente === "smn_alertas"), pend = smn?.detalle?.pendientes ?? 0;
  const html = al.map((a) => {
    const [sev, c] = SEVERIDAD[a.severidad] ?? [a.severidad ?? "", "--l-amarillo"];
    const donde = [a.toca_norden && "Norden", a.toca_martin_garcia && "Isla Martín García"].filter(Boolean).join(" y ");
    return `<div class="alerta" style="--c:var(${c})"><h3>${esc(a.evento)} <small>(${esc(sev)})</small></h3>
      <div class="nota" style="margin:0 0 4px">Afecta: ${esc(donde)} · desde ${fechaHora(a.desde)} hasta ${fechaHora(a.hasta)}</div><div>${esc(a.descripcion ?? "")}</div></div>`;
  }).join("");
  return plegable("sec-alertas", "Alertas SMN", al.length ? `${al.length} vigente${al.length > 1 ? "s" : ""}` : "sin alertas",
    (html || `<p class="nota" style="margin-top:0">Sin alertas vigentes para Norden ni para la Isla Martín García.</p>`) + (pend > 0 ? `<p class="nota">Todavía revisando avisos del SMN (faltan ${pend}).</p>` : ""));
}

function realVsPron(d) {
  const t1 = Date.now(), t0 = t1 - 864e5;
  const real = (d.l24 ?? []).filter((l) => l.estacion === "norden" && l.viento_kn != null).map((l) => [new Date(l.ts).getTime(), l.viento_kn]);
  const ph = porHora(d.pron6 ?? []).filter((p) => p.t >= t0 && p.t <= t1);
  const graf = grafico("rvp", "lec-rvp", { t0, t1, fmtV: n1, H: 170,
    series: [{ nombre: "Real", puntos: real, color: "var(--acento)", ancho: 2, cortarMin: 20 }, { nombre: "Pronóstico", puntos: ph.map((p) => [p.t, p.v]), color: "var(--serie2)", ancho: 2, cortarMin: 65 }],
    banda: ph.filter((p) => p.n > 1).map((p) => [p.t, p.vMin, p.vMax]) });
  // Ranking con el resumen diario (pronosticos de 0 a 24 h de anticipacion)
  const NOM = { ecmwf: "ECMWF", gfs: "GFS", icon: "ICON", promedio: "Promedio de los 3" };
  const err = d.errores ?? [], desde7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), dias = new Set(err.map((e) => e.dia)).size;
  const res = (fs) => { const n = fs.reduce((s, f) => s + f.horas_comparadas, 0); return n ? { abs: fs.reduce((s, f) => s + f.error_abs_medio * f.horas_comparadas, 0) / n, ses: fs.reduce((s, f) => s + f.error_medio * f.horas_comparadas, 0) / n } : null; };
  const filas = Object.keys(NOM).map((m) => ({ m, d7: res(err.filter((e) => e.modelo === m && e.dia >= desde7)), d30: res(err.filter((e) => e.modelo === m)) }));
  const mejor = filas.filter((f) => f.d30).sort((a, b) => a.d30.abs - b.d30.abs)[0]?.m;
  const celda = (r) => r ? `${n1(r.abs)} kn <small style="color:var(--suave)">(${r.ses >= 0 ? "+" : ""}${n1(r.ses)})</small>` : "–";
  const ranking = !err.length ? `<p class="nota" style="margin-top:0">Todavía no hay días completos para comparar. El resumen se arma cada madrugada a las 3:30.</p>`
    : `${dias < 3 ? `<p class="nota" style="margin-top:0"><strong>Todavía pocos datos (${dias} día${dias > 1 ? "s" : ""}).</strong> No sacar conclusiones hasta tener al menos una semana.</p>` : ""}
      <table class="ranking"><thead><tr><th>Modelo</th><th>Últimos 7 días</th><th>Últimos 30 días</th></tr></thead><tbody>
      ${filas.map((f) => `<tr style="${f.m === mejor && dias >= 3 ? "font-weight:700" : ""}"><td>${NOM[f.m]}</td><td>${celda(f.d7)}</td><td>${celda(f.d30)}</td></tr>`).join("")}</tbody></table>
      <p class="nota">Error promedio del viento medio en Norden, pronósticos de hasta 24 h. Entre paréntesis: + se pasa, − se queda corto.</p>`;
  return plegable("sec-rvp", "Real contra pronóstico", "gráfico y modelos", `<p class="nota" style="margin-top:0">Pronóstico = el que ya estaba disponible 6 horas antes de cada hora.</p>
    <div class="lectura" id="lec-rvp">Tocá el gráfico para ver cada valor.</div><div class="grafico">${graf}</div>
    <div class="leyenda"><span><i style="background:var(--acento)"></i>Real (Norden, nudos)</span><span><i style="background:var(--serie2)"></i>Pronóstico (promedio)</span><span><i style="background:var(--serie2);opacity:.3;height:10px"></i>Margen entre modelos</span></div>
    <h3 class="sub">¿Qué modelo acierta más en Norden?</h3>${ranking}`);
}

const NOMBRE_FUENTE = { carp: "CARP (4 estaciones)", armada_colonia: "Armada Colonia", open_meteo: "Open-Meteo", smn_alertas: "Alertas SMN", sohma: "Avisos SOHMA (cada hora)", carp_tramos: "Tabla de tramos CARP (lunes 9 h)", visibilidad: "Visibilidad (Open-Meteo: ECMWF 9 km y GFS)", comparar_marea: "Comparación de marea SHN / PronUy (prueba)" };
// Cuanto puede pasar sin lectura buena antes de marcar problema (minutos).
const PLAZO_FUENTE = { sohma: 90, carp_tramos: 8 * 24 * 60, comparar_marea: 120 };
// Renglon de la comparacion de marea (robot de prueba de 4 semanas). PronUy caido es solo una nota: no pone rojo.
const conSigno = (x) => x == null ? "–" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${m2(Math.abs(x))}`;
function resumenComparacion(d) {
  if (!d) return "";
  if (d.terminado) return `Terminada el ${fechaHora(d.terminado_en)} (4 semanas). Datos guardados; informe pendiente.`;
  const p = [];
  if (d.dia) p.push(`día ${d.dia} de ${d.de}`);
  const A = d.A;
  if (A?.n) {
    const salto = A.saltos?.length ? A.saltos[A.saltos.length - 1] : null;
    p.push(`Norden SHN−CARP ${conSigno(A.actual)} m (dispersión ${m2(A.dispersion)}${salto ? `; ⚠ salto de ${conSigno(salto.antes)} a ${conSigno(salto.despues)} el ${fechaHora(salto.t)}` : ""})`);
  }
  const B = d.B ?? {}, nC = Object.values(d.C ?? {}).reduce((s, x) => s + (x?.n ?? 0), 0);
  const b = (x, nom) => x?.n ? `${nom} ${conSigno(x.altura_media)} m / ${conSigno(x.hora_media_h)} h (${x.n})` : null;
  const bs = [b(B.san_fernando, "S. Fernando"), b(B.buenos_aires, "Bs. As.")].filter(Boolean);
  p.push(bs.length ? `pronóstico SHN contra lo medido: ${bs.join(" · ")}` : "pronóstico SHN: todavía sin pleamares/bajamares para comparar");
  if (nC) p.push(`${nC} comparaciones contra Norden/Colonia`);
  p.push(d.pronuy?.estado === "responde" ? `PronUy: responde (${d.pronuy.guardadas} guardadas)` : `PronUy: sin conexión desde ${fechaHora(d.pronuy?.desde)}`);
  return p.join(" · ");
}
function robot(d) {
  const f = d.fuentes ?? [];
  const mal = (x) => x.detalle?.terminado ? false : (x.ultimo_error && (!x.ultimo_ok || x.ultimo_error > x.ultimo_ok)) || !x.ultimo_ok || minDesde(x.ultimo_ok) > (PLAZO_FUENTE[x.fuente] ?? VIEJO_MIN);
  const malas = f.filter(mal).length;
  return plegable("sec-robot", "Estado del robot", malas ? `${malas} con problemas` : "todo en orden",
    `<ul class="fuentes">${f.map((x) => `<li><span class="${mal(x) ? "mal" : "ok"}">${ic(mal(x) ? "alerta" : "ok")}</span><span>${esc(NOMBRE_FUENTE[x.fuente] ?? x.fuente)}: ${x.ultimo_ok ? `leída ${hora(x.ultimo_ok)}` : "nunca"}${x.ultimo_error && (!x.ultimo_ok || x.ultimo_error > x.ultimo_ok) ? ` — error: ${esc(x.mensaje_error)}` : ""}${x.fuente === "comparar_marea" && x.detalle ? `<small class="det-fuente">${esc(resumenComparacion(x.detalle))}</small>` : ""}</span></li>`).join("")}</ul>`);
}

// ---------- todo ----------
function render(d) {
  ultimos = d;
  // Recordar lo abierto y lo desplazado para que la actualizacion cada 2 minutos no lo cierre.
  const abiertosAhora = new Set([...raiz.querySelectorAll("details[data-clave][open]")].map((x) => x.dataset.clave));
  const cerradosAhora = new Set([...raiz.querySelectorAll("details.radioaviso[data-clave]:not([open])")].map((x) => x.dataset.clave));
  const ix = indexar(d.ultimas ?? []);
  const nombre = Object.fromEntries((d.estaciones ?? []).map((e) => [e.id, e.nombre]));
  const cd = canalDatos(d);
  raiz.innerHTML = barra(d, cd) + `<main>
    ${norden(ix, d.pron6 ?? [])}${aguaSec(d, ix, aguaAj)}${pronostico(d.pronostico ?? [], d.config, d.vis ?? [])}${marea(d.l24 ?? [])}${otras(ix, nombre)}
    ${canal(d, cd)}${alertasSec(d)}${realVsPron(d)}${robot(d)}</main>
    <footer><div><p>Esta app es una ayuda. No reemplaza la consulta de las fuentes oficiales para tomar decisiones de seguridad.</p>
    <p>Fuentes: CARP, Armada Nacional (SOHMA), Open-Meteo, SMN. Hora de Uruguay (UTC-3). Viento en nudos, marea en metros (LIMB).</p></div></footer>`;
  for (const el of raiz.querySelectorAll("details[data-clave]")) {
    if (abiertosAhora.has(el.dataset.clave)) el.open = true;
    if (cerradosAhora.has(el.dataset.clave)) el.open = false;
  }
}

raiz.addEventListener("pointerdown", tocarGrafico);
raiz.addEventListener("pointermove", tocarGrafico);
raiz.addEventListener("toggle", (ev) => {
  const el = ev.target;
  if (!el.classList?.contains("plegable")) return;
  if (el.open) abiertas.add(el.id); else abiertas.delete(el.id);
  guardarLocal("secciones_abiertas", [...abiertas]);
}, true);
raiz.addEventListener("click", (ev) => {
  const b = ev.target.closest("button, [data-ir]");
  if (!b) return;
  if (b.dataset.marea) { mareaExtra = mareaExtra === b.dataset.marea ? null : b.dataset.marea; guardarLocal("marea_extra", mareaExtra); render(ultimos); return; }
  if (b.dataset.ir) { const s = document.getElementById(b.dataset.ir); if (s) { s.open = true; s.scrollIntoView({ behavior: "smooth", block: "start" }); } return; }
  if (b.id === "btn-ajustes" || b.dataset.abrirAjustes) { abrirAjustes(); return; }
  if (b.id === "btn-relev-visto") { guardarLocal("relevamiento_visto", ultimoCambioCarp(ultimos)); render(ultimos); return; }
  if (b.id === "btn-visto") {
    const cd = canalDatos(ultimos), s = vistas();
    for (const n of [...cd.radio, ...cd.balizas, ...cd.normalizadas]) s.add(claveVista(n));
    guardarLocal("canal_vistas", [...s].slice(-500));
    render(ultimos); return;
  }
  if (b.dataset.nota) {
    const senal = b.dataset.nota, todas = notas();
    const texto = prompt(`Tu nota para la señal Nº ${senal} (no oficial, queda en este celular).\nDejala vacía para borrarla.`, todas[senal]?.texto ?? "");
    if (texto === null) return;
    if (texto.trim()) todas[senal] = { texto: texto.trim(), fecha: new Date().toISOString() }; else delete todas[senal];
    guardarLocal("notas_senal", todas);
    render(ultimos);
  }
});

// ---------- ciclo ----------
async function actualizar() {
  try {
    const d = await bajarTodo();
    guardarLocal("ultimos_datos", { t: Date.now(), d });
    sinSenal = null;
    render(d);
  } catch (e) {
    const c = leerLocal("ultimos_datos");
    sinSenal = c ? c.t : Date.now();
    if (c) render(c.d);
    else raiz.innerHTML = `<p style="padding:16px">Sin señal y sin datos guardados todavía.</p>`;
  }
}

// ---------- ajustes ----------
const dlg = document.getElementById("ajustes"), form = document.getElementById("form-ajustes");
const llenarForm = (v) => { for (const [k, x] of Object.entries(v)) if (form.elements[k]) form.elements[k].value = x ?? ""; };
const errorAgua = document.getElementById("error-agua");
function abrirAjustes() {
  llenarForm(lim); llenarForm(aguaAj); errorAgua.hidden = true;
  form.elements.noche.checked = document.documentElement.dataset.tema === "noche"; dlg.showModal();
}
document.getElementById("btn-defecto").onclick = () => { llenarForm(DEFECTO); llenarForm({ margen: AGUA_DEFECTO.margen, colchon: AGUA_DEFECTO.colchon }); };
// Al cambiar metros/pies, se pasa el calado cargado a la otra unidad.
form.elements.unidad.addEventListener("change", (ev) => {
  const x = form.elements.calado.value.trim();
  if (x !== "") form.elements.calado.value = String(Math.round((ev.target.value === "ft" ? Number(x) / PIE : Number(x) * PIE) * 100) / 100);
});
// Margen menor que 0,60 (u otro valor que no va): no deja guardar.
form.addEventListener("submit", (ev) => {
  if (ev.submitter?.value !== "guardar") return;
  const r = revisarAgua({ calado: form.elements.calado.value.trim(), unidad: form.elements.unidad.value, margen: form.elements.margen.value.trim(), colchon: form.elements.colchon.value.trim() });
  errorAgua.hidden = !r.error; errorAgua.textContent = r.error ?? "";
  if (r.error) { ev.preventDefault(); errorAgua.scrollIntoView({ block: "nearest" }); return; }
  aguaAj = r.valores;
  guardarLocal("agua_canal", aguaAj);
});
dlg.addEventListener("close", () => {
  if (dlg.returnValue !== "guardar") return;
  const nuevo = {};
  for (const k of Object.keys(DEFECTO)) { const x = form.elements[k].value.trim(); nuevo[k] = x === "" ? DEFECTO[k] : Number(x); }
  lim = nuevo;
  guardarLocal("limites", lim);
  const noche = form.elements.noche.checked;
  guardarLocal("modo_noche", noche);
  if (noche) document.documentElement.dataset.tema = "noche"; else delete document.documentElement.dataset.tema;
  colorBarraCelular();
  if (ultimos) render(ultimos);
});

// Color de la barra del celular: negra en modo noche.
function colorBarraCelular() {
  const noche = document.documentElement.dataset.tema === "noche";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.dataset.normal ??= m.content; m.content = noche ? "#000000" : m.dataset.normal; });
}

// ---------- arranque ----------
colorBarraCelular();
if (!window.MODO_PRUEBA) { // la pagina de pruebas (solo en la compu) usa las funciones sin bajar datos
  const cache = leerLocal("ultimos_datos");
  if (cache) render(cache.d);
  actualizar();
  setInterval(() => { if (document.visibilityState === "visible") actualizar(); }, REFRESCO_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") actualizar(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
