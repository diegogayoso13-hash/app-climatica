// ---------- Mapa del canal (pantalla completa) ----------
// Usa: senales.json (6 columnas de la planilla de la CARP), Leaflet (en vendor/, se carga al abrir el mapa)
// y fondo de OpenStreetMap. Sin señal, el canal, los tramos y las señales se dibujan igual (no dependen del fondo).

// Los archivos del mapa estan al lado de mapa.js (sirve igual en la app publicada y en las pruebas).
const BASE_MAPA = new URL(".", document.currentScript?.src ?? location.href).href;
let SENALES = null;
async function cargarSenales() {
  if (!SENALES) SENALES = (await (await fetch(BASE_MAPA + "senales.json")).json()).senales.map(([km, tipo, color, lat, lon, destello]) => ({ km, tipo, color, lat, lon, destello }));
  return SENALES;
}
function cargarLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((ok, mal) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = BASE_MAPA + "vendor/leaflet/leaflet.css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = BASE_MAPA + "vendor/leaflet/leaflet.js"; js.onload = ok; js.onerror = () => mal(new Error("no se pudo cargar el mapa"));
    document.head.appendChild(js);
  });
}

// Eje del canal: punto medio de cada par roja/verde del mismo km; donde hay una sola lateral, esa.
// Eje (medio) del canal. Con par de boyas: el punto medio. Con boya de un solo lado: medio ancho del tramo
// (tabla de anchos de la CARP) hacia adentro del canal: desde una roja hacia babor subiendo, desde una verde hacia
// estribor (sistema B: subiendo, rojas a estribor). Sin la tabla de anchos queda sobre la boya (como antes).
function ejeCanal(ss, tramos = null) {
  const porKm = new Map();
  for (const s of ss) (porKm.get(s.km) ?? porKm.set(s.km, []).get(s.km)).push(s);
  const kms = [...porKm.keys()].sort((a, b) => a - b), eje = [];
  const lat_ = (c) => { const vistos = new Set(); return ss.filter((s) => s.tipo === "Lateral" && (c === "roja" ? s.color.startsWith("roja") : s.color === "verde")).sort((a, b) => a.km - b.km).filter((s) => !vistos.has(s.km) && vistos.add(s.km)); };
  const cadena = { roja: lat_("roja"), verde: lat_("verde") };
  for (const km of kms) {
    const g = porKm.get(km), r = g.find((s) => s.tipo === "Lateral" && s.color.startsWith("roja")), v = g.find((s) => s.tipo === "Lateral" && s.color === "verde");
    if (r && v) eje.push({ km, lat: (r.lat + v.lat) / 2, lon: (r.lon + v.lon) / 2 });
    else if (r || v) {
      const b = r || v, t = tramoDeKm(tramos, km), medio = t && Number(t.ancho_m) > 0 ? Number(t.ancho_m) / 2 : 0;
      if (!medio) { eje.push({ km, lat: b.lat, lon: b.lon }); continue; }
      // direccion de "km creciente" en ese lugar, siguiendo las boyas del mismo color
      const c = cadena[r ? "roja" : "verde"], [la1, lo1] = enKm(c, km - 0.3), [la2, lo2] = enKm(c, km + 0.3);
      const d = planoM({ lat: la1, lon: lo1 }, { lat: la2, lon: lo2 }), l = Math.hypot(d.x, d.y) || 1;
      const sx = (r ? -1 : 1) * d.y / l, sy = (r ? -1 : 1) * -d.x / l; // roja: a babor (izquierda) · verde: a estribor (derecha)
      eje.push({ km, lat: b.lat + sy * medio / 110540, lon: b.lon + sx * medio / (111320 * Math.cos(b.lat * Math.PI / 180)), unLado: r ? "roja" : "verde", medio });
    }
    else if (km === kms[0] || km === kms[kms.length - 1]) eje.push({ km, lat: g[0].lat, lon: g[0].lon }); // los extremos (km 39, 145,5)
  }
  return eje;
}
const anchosClave = (tramos) => (tramos ?? []).map((t) => `${t.km_desde}-${t.km_hasta}:${t.ancho_m}`).join("|");
// Posicion aproximada de un km sobre el eje (interpolando entre los puntos del eje).
function enKm(eje, km) {
  if (km <= eje[0].km) return [eje[0].lat, eje[0].lon];
  for (let i = 1; i < eje.length; i++) if (km <= eje[i].km) {
    const a = eje[i - 1], b = eje[i], f = (km - a.km) / (b.km - a.km);
    return [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f];
  }
  const z = eje[eje.length - 1]; return [z.lat, z.lon];
}
const tramoEnEje = (eje, a, b) => [enKm(eje, a), ...eje.filter((p) => p.km > a && p.km < b).map((p) => [p.lat, p.lon]), enKm(eje, b)];

// Novedades del SOHMA sobre las señales: SOLO si hay una única señal del mismo km y lado (IALA B: estribor = roja).
// Lo que no se une con seguridad queda en una lista aparte (no se adivina).
function unirSohma(ss, balizas) {
  const unidas = [], revisar = [], sinPosicion = [];
  for (const n of balizas) {
    const d = (n.descripcion ?? "").toUpperCase();
    const lado = d.includes("ESTRIBOR") ? "roja" : d.includes("BABOR") ? "verde" : null;
    if (!lado) { sinPosicion.push({ n, motivo: d.includes("ESPECIAL") ? "señal especial que no está en la planilla" : "tipo de señal sin lado" }); continue; }
    const mismoLado = ss.filter((s) => s.tipo === "Lateral" && s.color.startsWith(lado));
    const exactas = mismoLado.filter((s) => Math.abs(s.km - n.km) < 0.05);
    if (exactas.length === 1) { unidas.push({ n, s: exactas[0] }); continue; }
    const cerca = mismoLado.reduce((a, s) => !a || Math.abs(s.km - n.km) < Math.abs(a.km - n.km) ? s : a, null);
    revisar.push({ n, motivo: exactas.length > 1 ? `${exactas.length} señales ${lado}s en el mismo km` : `SOHMA km ${kmTxt(n.km)}; la ${lado} más cercana de la planilla está en el km ${kmTxt(cerca.km)}` });
  }
  return { unidas, revisar, sinPosicion };
}

// ----- mi posicion (GPS del celular; no necesita internet) -----
// Km del canal: se proyecta la posicion sobre el eje (el tramo de recta mas cercano) y se interpola el km.
function kmDePosicion(eje, lat, lon) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540; // metros por grado (plano local)
  let mejor = null;
  for (let i = 1; i < eje.length; i++) {
    const a = eje[i - 1], b = eje[i];
    const ax = (a.lon - lon) * kx, ay = (a.lat - lat) * ky, bx = (b.lon - lon) * kx, by = (b.lat - lat) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const px = ax + t * dx, py = ay + t * dy, dist = Math.hypot(px, py);
    // rumboEje: hacia donde crece el km en ese tramo de recta (para saber si voy aguas arriba o abajo)
    if (!mejor || dist < mejor.dist) mejor = { km: a.km + t * (b.km - a.km), dist, rumboEje: (Math.atan2(dx, dy) * 180 / Math.PI + (b.km >= a.km ? 360 : 540)) % 360 };
  }
  return mejor;
}

// ----- velocidad, rumbo y proximo punto de informacion (todo en el celular, sin internet) -----
// Puntos de informacion del REMAGA 2019 (ETA y hora de paso, canal 81). Aguas arriba = km creciente (REMAGA).
const PUNTOS_INFO = [39, 60.1, 80.1, 89.6, 93, 118.2, 134.2, 143.2, 145.5];
const KN_MS = 1852 / 3600, VENTANA_MS = 10000, DETENIDO_KN = 0.5, SIN_DATO_MS = 30000, PRECISION_CALCULO_M = 50;
const PUNTOS8 = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const rumbo8 = (g) => PUNTOS8[Math.round((((g % 360) + 360) % 360) / 45) % 8];
function planoM(a, b) { // metros este/norte de a hacia b
  const kx = 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return { x: (b.lon - a.lon) * kx, y: (b.lat - a.lat) * 110540 };
}
const rumboEntre = (a, b) => { const p = planoM(a, b); return (Math.atan2(p.x, p.y) * 180 / Math.PI + 360) % 360; };
const distEntre = (a, b) => { const p = planoM(a, b); return Math.hypot(p.x, p.y); };
const mediaRecortada = (xs) => { const s = [...xs].sort((a, b) => a - b); const u = s.length >= 5 ? s.slice(1, -1) : s; return u.reduce((a, b) => a + b, 0) / u.length; };
const mediaAngulos = (gs) => { const x = gs.reduce((a, g) => a + Math.sin(g * Math.PI / 180), 0), y = gs.reduce((a, g) => a + Math.cos(g * Math.PI / 180), 0); return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360; };
// hist: posiciones { t, lat, lon, acc, v (m/s o null), rumbo (grados o null) }. Devuelve null si no hay posicion de los ultimos 30 s.
function movimiento(hist, ahora) {
  const ult = hist[hist.length - 1];
  if (!ult || ahora - ult.t > SIN_DATO_MS) return null;
  const ven = hist.filter((h) => h.t >= ult.t - VENTANA_MS);
  const conV = ven.filter((h) => h.v != null);
  // Para calcular con las posiciones: las precisas de la ventana (o de los ultimos 30 s si en 10 s hay pocas)
  let buenas = ven.filter((h) => h.acc == null || h.acc <= PRECISION_CALCULO_M);
  if (buenas.length < 2 || buenas.at(-1).t - buenas[0].t < 2000) buenas = hist.filter((h) => ult.t - h.t <= SIN_DATO_MS && (h.acc == null || h.acc <= PRECISION_CALCULO_M));
  const par = buenas.length >= 2 && buenas.at(-1).t - buenas[0].t >= 2000 ? [buenas[0], buenas.at(-1)] : null;
  let ms = conV.length ? mediaRecortada(conV.map((h) => h.v)) : par ? distEntre(par[0], par[1]) / ((par[1].t - par[0].t) / 1000) : null;
  if (ms == null) return { kn: null, rumbo: null, detenido: false };
  const kn = ms / KN_MS, detenido = kn < DETENIDO_KN;
  const conR = ven.filter((h) => h.rumbo != null && (h.v == null || h.v >= 0.25));
  const rumbo = detenido ? null : conR.length ? mediaAngulos(conR.map((h) => h.rumbo)) : par && distEntre(par[0], par[1]) >= 5 ? rumboEntre(par[0], par[1]) : null;
  return { kn, rumbo, detenido };
}
// +1 aguas arriba, -1 aguas abajo, 0 = de traves al canal (no se sabe)
function sentidoDe(rumbo, rumboEje) {
  if (rumbo == null || rumboEje == null) return 0;
  const c = Math.cos((rumbo - rumboEje) * Math.PI / 180);
  return c > 0.25 ? 1 : c < -0.25 ? -1 : 0;
}
const PASADO_KM = 0.05; // a menos de 50 m de un punto ya se cuenta como pasado
const proximoPunto = (km, sentido) => sentido > 0 ? PUNTOS_INFO.find((p) => p > km + PASADO_KM) ?? null : [...PUNTOS_INFO].reverse().find((p) => p < km - PASADO_KM) ?? null;
const horaHM = (ms) => new Date(Math.round(ms / 60000) * 60000).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false });
const kmDist = (x) => x.toLocaleString("es-UY", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const LEJOS_DEL_EJE_M = 1500; // mas lejos que esto del eje: "fuera del canal"
const tramoDeKm = (tramos, km) => (tramos ?? []).find((t) => km >= Number(t.km_desde) && km < Number(t.km_hasta)) ?? (tramos ?? []).find((t) => km >= Number(t.km_desde) && km <= Number(t.km_hasta)) ?? null;
let GPS = { watch: null, marca: null, circulo: null, centrado: false, ultima: null, hist: [], sentido: 0, info: false, reloj: null };
const INFO_VEL = "Velocidad sobre el fondo, del GPS del celular, promediada 10 segundos (si el celular no la da, se calcula con las últimas posiciones). Detenido: menos de 0,5 kn. Aguas arriba = km creciente (REMAGA 2019). La hora de paso por el próximo punto de información (REMAGA 2019, canal 81) se estima con la velocidad de este momento: no tiene en cuenta si vas a frenar ni los cambios de corriente. Todo se calcula en el celular, sin internet.";
function textoPosicion(pos, ahora = Date.now()) {
  if (!MAPA) return "";
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;
  const r = kmDePosicion(MAPA.eje, lat, lon);
  const enCanal = r.dist <= LEJOS_DEL_EJE_M;
  const lineas = [];
  if (!enCanal) lineas.push(`Fuera del canal (a ${(r.dist / 1000).toLocaleString("es-UY", { maximumFractionDigits: 1 })} km del eje) · ±${Math.round(accuracy)} m`);
  else { const t = tramoDeKm(ultimos?.tramos, r.km); lineas.push(`km ${kmTxt(r.km)}${t ? ` · ${esc(t.nombre)}` : ""} · ±${Math.round(accuracy)} m`); }
  const m = movimiento(GPS.hist, ahora);
  if (!enCanal) GPS.sentido = 0;
  else if (m && !m.detenido && m.rumbo != null) { const s = sentidoDe(m.rumbo, r.rumboEje); if (s) GPS.sentido = s; } // de traves: queda el ultimo
  const lado = GPS.sentido > 0 ? "aguas arriba" : "aguas abajo";
  if (!m || m.kn == null) lineas.push("Velocidad: sin dato del GPS");
  else if (m.detenido) lineas.push(`detenido${enCanal && GPS.sentido ? ` · venías ${lado}` : ""}`);
  else lineas.push(`${kmDist(m.kn)} kn${m.rumbo != null ? ` · rumbo ${Math.round(m.rumbo) % 360}° · ${rumbo8(m.rumbo)}` : ""}${enCanal && GPS.sentido ? ` · ${lado}` : ""}`);
  if (enCanal) {
    if (GPS.sentido) {
      const p = proximoPunto(r.km, GPS.sentido);
      if (p == null) lineas.push(`Ya pasaste el último punto de información (km ${kmTxt(GPS.sentido > 0 ? PUNTOS_INFO.at(-1) : PUNTOS_INFO[0])})`);
      else {
        const d = Math.abs(p - r.km), andando = m && m.kn != null && !m.detenido;
        lineas.push(`Próximo punto: km ${kmTxt(p)} · a ${kmDist(d)} km · ${andando ? `paso ≈ ${horaHM(ahora + d * 1000 / (m.kn * KN_MS) * 1000)}` : `sin hora${m?.detenido ? " (detenido)" : ""}`}`);
      }
    } else { // todavia no se sabe para que lado: los dos vecinos, sin hora
      const ab = proximoPunto(r.km, -1), ar = proximoPunto(r.km, 1);
      lineas.push(`Puntos de información: ${[ab != null && `km ${kmTxt(ab)} (abajo) a ${kmDist(r.km - ab)} km`, ar != null && `km ${kmTxt(ar)} (arriba) a ${kmDist(ar - r.km)} km`].filter(Boolean).join(" · ")}`);
    }
  }
  return lineas.map((l, i) => `<span class="mp-l${i ? "" : " mp-km"}">${l}</span>`).join("")
    + `<span class="mp-aclara">Velocidad sobre el fondo (GPS) <button type="button" class="mp-i" aria-expanded="${GPS.info}" aria-label="Más información">i</button></span>`
    + (GPS.info ? `<span class="mp-info">${INFO_VEL}</span>` : "");
}
function pintarPosicion() {
  if (!GPS.ultima) return;
  const el = document.getElementById("mapa-pos"); if (!el) return;
  el.hidden = false; el.innerHTML = textoPosicion(GPS.ultima);
}
function mostrarPosicion(pos) {
  if (!MAPA) return;
  const ll = [pos.coords.latitude, pos.coords.longitude];
  GPS.ultima = pos;
  const c = pos.coords, num = (x) => typeof x === "number" && Number.isFinite(x) ? x : null;
  GPS.hist.push({ t: pos.timestamp ?? Date.now(), lat: c.latitude, lon: c.longitude, acc: num(c.accuracy), v: num(c.speed), rumbo: num(c.heading) });
  while (GPS.hist.length && GPS.hist.at(-1).t - GPS.hist[0].t > 60000) GPS.hist.shift();
  if (!GPS.marca) {
    GPS.circulo = L.circle(ll, { radius: pos.coords.accuracy, color: varCss("--acento"), weight: 1, fillOpacity: 0.12, interactive: false }).addTo(MAPA.map);
    GPS.marca = L.marker(ll, { icon: L.divIcon({ className: "yo", html: '<span class="yo-punto"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 2000, keyboard: false }).addTo(MAPA.map);
  } else { GPS.marca.setLatLng(ll); GPS.circulo.setLatLng(ll).setRadius(pos.coords.accuracy); }
  if (!GPS.centrado) { MAPA.map.setView(ll, Math.max(MAPA.map.getZoom(), 13)); GPS.centrado = true; }
  pintarPosicion();
}
function errorPosicion(e) {
  const el = document.getElementById("mapa-pos"); el.hidden = false;
  el.textContent = e.code === 1 ? "Sin permiso para usar el GPS (se cambia en los ajustes del navegador)." : e.code === 3 ? "Buscando GPS…" : "No se pudo obtener la posición.";
  if (e.code === 1) { guardarLocal("gps_activado", false); detenerGps(); }
}
function iniciarGps() {
  if (!("geolocation" in navigator)) { errorPosicion({ code: 2 }); return; }
  if (GPS.watch != null) { if (GPS.ultima && MAPA) MAPA.map.setView([GPS.ultima.coords.latitude, GPS.ultima.coords.longitude]); return; } // ya andaba: centrar
  GPS.centrado = false; GPS.hist = []; GPS.sentido = 0; // cada vez que se prende, el recorrido arranca de cero
  GPS.watch = navigator.geolocation.watchPosition(mostrarPosicion, errorPosicion, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  GPS.reloj = setInterval(pintarPosicion, 5000); // la hora de paso y el "sin dato" se actualizan aunque no llegue posicion nueva
  guardarLocal("gps_activado", true);
  document.getElementById("btn-gps")?.classList.add("activo");
  const el = document.getElementById("mapa-pos"); el.hidden = false; el.textContent = "Buscando GPS…";
}
function detenerGps() {
  if (GPS.watch != null) navigator.geolocation.clearWatch(GPS.watch);
  clearInterval(GPS.reloj);
  GPS.watch = null; GPS.centrado = false; GPS.reloj = null; GPS.hist = []; GPS.sentido = 0;
  document.getElementById("btn-gps")?.classList.remove("activo");
}

// ----- fondeaderos (REMAGA 2019, art. 2.13) -----
// Todos del lado de las boyas rojas: los de emergencia "veril rojo"; los de uso normal, lado uruguayo
// (comprobado con las coordenadas: en esos tramos las rojas quedan del lado de la costa uruguaya).
const FONDEOS = [
  { km: [124.5, 130.2], nombre: "Fondeadero (uso normal)", donde: "fuera del canal, lado uruguayo; la posición exacta la indica la Autoridad Marítima", art: "2.13.1" },
  { km: [137.3, 141.4], nombre: "Fondeadero (uso normal)", donde: "fuera del canal, lado uruguayo; la posición exacta la indica la Autoridad Marítima", art: "2.13.1" },
  { km: [108.3, 109.2], nombre: "Fondeadero de emergencia · Canal del Infierno", emergencia: true, donde: "fuera del canal, veril rojo (lado de las boyas rojas)", art: "2.13.2" },
  { km: [84.7, 85.7], nombre: "Fondeadero de emergencia · Pozos de San Juan", emergencia: true, donde: "fuera del canal, veril rojo (lado de las boyas rojas), área demarcada con señales especiales amarillas · 7,15 m", art: "2.13.2" },
];
const FONDEO_AFUERA_M = 200; // la linea punteada va 200 m por afuera de la linea de boyas rojas
const boyasRojas = (ss) => { const vistos = new Set(); return ss.filter((s) => s.tipo === "Lateral" && s.color.startsWith("roja")).sort((a, b) => a.km - b.km).filter((s) => !vistos.has(s.km) && vistos.add(s.km)); };
// Linea de las boyas rojas entre dos km, corrida "m" metros hacia afuera (a estribor subiendo = lado de las rojas, sistema B).
// Cada punto trae nx, ny: la direccion "hacia afuera" (este, norte).
function bordeRojo(rojas, a, b, m) {
  const kms = [a, ...rojas.filter((r) => r.km > a && r.km < b).map((r) => r.km), ...(b > a ? [b] : [])];
  return kms.map((km) => {
    const [la, lo] = enKm(rojas, km), [la1, lo1] = enKm(rojas, km - 0.2), [la2, lo2] = enKm(rojas, km + 0.2);
    const t = planoM({ lat: la1, lon: lo1 }, { lat: la2, lon: lo2 }), l = Math.hypot(t.x, t.y) || 1;
    const nx = t.y / l, ny = -t.x / l; // a la derecha de "km creciente"
    return { km, lat: la + ny * m / 110540, lon: lo + nx * m / (111320 * Math.cos(la * Math.PI / 180)), nx, ny };
  });
}

// ----- dibujo -----
const varCss = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const FORMA = (s) => s.tipo === "Lateral" ? (s.color === "verde" ? "verde" : s.color.includes("CPB") ? "cpb" : "roja")
  : s.tipo === "Cardinal" ? "cardinal" : s.tipo === "Peligro aislado" ? "peligro" : "baliza";
let MAPA = null;
function panelMapa() {
  let p = document.getElementById("panel-mapa");
  if (p) return p;
  p = document.createElement("div"); p.id = "panel-mapa"; p.className = "panel-mapa"; p.hidden = true;
  p.innerHTML = `<header class="mapa-barra"><button type="button" class="btn-icono" id="btn-cerrar-mapa" aria-label="Volver">←</button><strong>Mapa del canal</strong><span class="mapa-act" id="mapa-act"></span></header>
    <div class="mapa-cont"><div id="mapa" class="mapa"></div>
      <button type="button" class="btn-gps" id="btn-gps" aria-label="Mi posición" title="Mi posición (GPS)">📍</button>
      <div class="mapa-pos" id="mapa-pos" hidden></div></div>
    <details class="mapa-pie" id="mapa-pie"><summary><span>Posiciones de referencia; pueden no reflejar cambios recientes.</span><span class="chev-m">Leyenda ▾</span></summary><div id="mapa-leyenda"></div></details>`;
  document.body.appendChild(p);
  p.querySelector("#btn-cerrar-mapa").addEventListener("click", () => history.state?.mapa ? history.back() : cerrarMapa());
  p.querySelector("#btn-gps").addEventListener("click", () => iniciarGps());
  p.querySelector("#mapa-pos").addEventListener("click", (ev) => { if (ev.target.closest(".mp-i")) { GPS.info = !GPS.info; pintarPosicion(); } });
  return p;
}
async function abrirMapa() {
  const p = panelMapa();
  p.hidden = false; document.documentElement.classList.add("con-mapa");
  if (!history.state?.mapa) history.pushState({ mapa: 1 }, "", "#mapa");
  try {
    await cargarLeaflet();
    const ss = await cargarSenales();
    if (!MAPA) {
      const map = L.map("mapa", { zoomControl: true, attributionControl: true, preferCanvas: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
      map.fitBounds(L.latLngBounds(ss.map((s) => [s.lat, s.lon])), { padding: [16, 16] });
      MAPA = { map, capa: L.layerGroup().addTo(map), eje: ejeCanal(ss, ultimos?.tramos), anchos: anchosClave(ultimos?.tramos) };
    }
    setTimeout(() => MAPA.map.invalidateSize(), 50);
    dibujarMapa(ultimos);
    if (leerLocal("gps_activado")) iniciarGps(); // si ya diste permiso, arranca solo
  } catch (e) {
    document.getElementById("mapa").innerHTML = `<p style="padding:16px">${esc(e.message)}. Probá de nuevo con señal.</p>`;
  }
}
function cerrarMapa() {
  const p = document.getElementById("panel-mapa"); if (p) p.hidden = true;
  detenerGps(); // no gastar bateria con el mapa cerrado
  document.documentElement.classList.remove("con-mapa");
}
window.addEventListener("popstate", () => { if (!history.state?.mapa) cerrarMapa(); else if (document.getElementById("panel-mapa")?.hidden) abrirMapa(); });

function dibujarMapa(d) {
  if (!MAPA || !d || !SENALES) return;
  if (anchosClave(d.tramos) !== MAPA.anchos) { MAPA.eje = ejeCanal(SENALES, d.tramos); MAPA.anchos = anchosClave(d.tramos); } // cambio la tabla de anchos de la CARP
  const { map, capa, eje } = MAPA, ss = SENALES;
  capa.clearLayers();
  const ix = indexar(d.ultimas ?? []), aj = aguaAj;
  const c = d.tramos?.length ? calcularAgua(d.tramos, ix, aj) : null;
  const COLOR = { verde: varCss("--l-verde"), amarillo: varCss("--l-amarillo"), rojo: varCss("--l-rojo"), gris: varCss("--suave"), "sin-calado": varCss("--acento") };
  // Zonas de cruce de la eslora cargada (abajo de todo, anchas y transparentes)
  const gc = grupoCruce(aj.eslora ?? null, aj.manga ?? null);
  if (gc) for (const [a, b] of gc.g.km) L.polyline(tramoEnEje(eje, a, b), { color: varCss("--acento"), weight: 22, opacity: 0.22, lineCap: "butt", interactive: false }).addTo(capa);
  // Tramos con el color del agua
  for (const f of c?.filas ?? []) {
    const t = f.t, col = COLOR[f.estado] ?? COLOR.gris;
    L.polyline(tramoEnEje(eje, Number(t.km_desde), Number(t.km_hasta)), { color: col, weight: 7, opacity: 0.85, dashArray: f.estado === "gris" ? "6 6" : null })
      .bindPopup(`<strong>${esc(t.nombre)}</strong><br>km ${kmTxt(t.km_desde)}–${kmTxt(t.km_hasta)}<br>${f.agua == null ? "sin marea reciente" : `${m2(f.agua)} m de agua${f.quilla == null ? "" : ` · ${m2(f.quilla)} m bajo la quilla`}`}`).addTo(capa);
  }
  // Km cada 5
  for (let km = 40; km <= 145; km += 5) L.marker(enKm(eje, km), { icon: L.divIcon({ className: "km-et", html: `km ${km}`, iconSize: null }), interactive: false, keyboard: false }).addTo(capa);
  // Fondeaderos (REMAGA art. 2.13): FUERA del canal, del lado de las boyas rojas (nunca un ancla sobre el canal).
  // El REMAGA los da por km: se marca el tramo con una linea punteada por afuera de las rojas y el ancla al costado.
  const rojas = boyasRojas(ss);
  for (const f of FONDEOS) {
    const linea = bordeRojo(rojas, f.km[0], f.km[1], FONDEO_AFUERA_M);
    const color = f.emergencia ? varCss("--l-naranja") : varCss("--acento");
    const pop = `<strong>${esc(f.nombre)}</strong><br>km ${kmTxt(f.km[0])}–${kmTxt(f.km[1])} · ${esc(f.donde)}<br><small>REMAGA 2019, art. ${f.art}</small>`;
    L.polyline(linea.map((x) => [x.lat, x.lon]), { color, weight: 3, dashArray: "6 6", opacity: 0.95 }).bindPopup(pop).addTo(capa);
    const medio = bordeRojo(rojas, (f.km[0] + f.km[1]) / 2, (f.km[0] + f.km[1]) / 2, FONDEO_AFUERA_M)[0];
    // el ancla se corre 24 px mas hacia afuera (distancia fija en pantalla: no marca un lugar exacto)
    L.marker([medio.lat, medio.lon], { icon: L.divIcon({ className: `fondeo-et ${f.emergencia ? "emerg" : ""}`, html: "⚓", iconSize: [26, 26], iconAnchor: [13 - medio.nx * 24, 13 + medio.ny * 24] }) })
      .bindPopup(pop).addTo(capa);
  }
  // Señales, con las novedades del SOHMA
  const cd = canalDatos(d), u = unirSohma(ss, [...cd.balizas, ...cd.normalizadas.filter((n) => n.tipo === "baliza")]);
  const nov = new Map(u.unidas.map((x) => [x.s, x.n])), misNotas = notas();
  for (const s of ss) {
    const n = nov.get(s), forma = FORMA(s);
    const estado = n ? (n.normalizada_en ? "NORMALIZADA" : n.estado) : null;
    const html = `<span class="sm sm-${forma}"></span>${estado ? `<span class="sm-anillo ${/FALTA|HUNDIDA/.test(estado) ? "e-falta" : estado === "NORMALIZADA" ? "e-ok" : "e-aviso"}"></span><span class="sm-et">${esc(estado)}</span>` : ""}`;
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: `senal ${estado ? "con-nov" : ""}`, html, iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: estado ? 1000 : 0 })
      .bindPopup(`<strong>km ${kmTxt(s.km)} · ${esc(s.tipo)}${s.color ? ` ${esc(s.color)}` : ""}</strong><br>Destello: ${esc(s.destello || "–")}${n ? `<br><strong>SOHMA Nº ${esc(n.clave)}: ${esc(estado)}</strong> · ${n.normalizada_en ? `normalizada ${fechaHora(n.normalizada_en)}` : `visto desde ${fechaHora(n.primera_vez)}`}${misNotas[n.clave] ? `<br>Tu nota (solo en este celular): ${esc(misNotas[n.clave].texto)}` : ""}` : ""}`).addTo(capa);
  }
  // Leyenda y listas aparte
  document.getElementById("mapa-act").textContent = sinSenal ? "sin señal" : `act. ${hora(Date.now())}`;
  document.getElementById("mapa-leyenda").innerHTML = `
    <div class="ley-fila"><span><i class="sm sm-roja"></i>lateral roja (estribor)</span><span><i class="sm sm-verde"></i>lateral verde (babor)</span><span><i class="sm sm-cardinal"></i>cardinal</span><span><i class="sm sm-peligro"></i>peligro aislado</span><span><i class="sm sm-baliza"></i>baliza</span></div>
    <div class="ley-fila"><span><i class="ley-linea" style="background:${COLOR.verde}"></i>agua: verde / amarillo / rojo según tu calado</span><span>${gc ? `<i class="ley-linea ancha"></i>zonas de cruce de tu eslora (${n0(aj.eslora ?? 0)} m)` : "Cargá la eslora para ver tus zonas de cruce"}</span><span>⚓ <i class="ley-punteada"></i> fondeaderos, fuera del canal del lado de las boyas rojas</span></div>
    ${u.revisar.length ? `<h3 class="sub">Novedades para revisar (no se unieron solas)</h3><ul class="reglas">${u.revisar.map((x) => `<li>Nº ${esc(x.n.clave)} · ${esc(x.n.estado ?? "")} — ${esc(x.motivo)}</li>`).join("")}</ul>` : ""}
    ${u.sinPosicion.length ? `<h3 class="sub">Novedades sin posición en el mapa</h3><ul class="reglas">${u.sinPosicion.map((x) => `<li>Nº ${esc(x.n.clave)} · km ${kmTxt(x.n.km)} · ${esc((x.n.descripcion ?? "").replace(/\s*KM\s*[\d.,]+/i, "").toLowerCase())} · <strong>${esc(x.n.estado ?? "")}</strong> — ${esc(x.motivo)}</li>`).join("")}</ul>` : ""}
    <p class="nota">Señales: planilla de la CARP (km, tipo, color, posición y destello). Fondo: © OpenStreetMap. Referencia, no oficial.</p>`;
}
