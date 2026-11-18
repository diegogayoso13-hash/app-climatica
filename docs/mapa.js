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
function ejeCanal(ss) {
  const porKm = new Map();
  for (const s of ss) (porKm.get(s.km) ?? porKm.set(s.km, []).get(s.km)).push(s);
  const kms = [...porKm.keys()].sort((a, b) => a - b), eje = [];
  for (const km of kms) {
    const g = porKm.get(km), r = g.find((s) => s.tipo === "Lateral" && s.color.startsWith("roja")), v = g.find((s) => s.tipo === "Lateral" && s.color === "verde");
    if (r && v) eje.push({ km, lat: (r.lat + v.lat) / 2, lon: (r.lon + v.lon) / 2 });
    else if (r || v) eje.push({ km, lat: (r || v).lat, lon: (r || v).lon });
    else if (km === kms[0] || km === kms[kms.length - 1]) eje.push({ km, lat: g[0].lat, lon: g[0].lon }); // los extremos (km 39, 145,5)
  }
  return eje;
}
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
    if (!mejor || dist < mejor.dist) mejor = { km: a.km + t * (b.km - a.km), dist };
  }
  return mejor;
}
const LEJOS_DEL_EJE_M = 1500; // mas lejos que esto del eje: "fuera del canal"
const tramoDeKm = (tramos, km) => (tramos ?? []).find((t) => km >= Number(t.km_desde) && km < Number(t.km_hasta)) ?? (tramos ?? []).find((t) => km >= Number(t.km_desde) && km <= Number(t.km_hasta)) ?? null;
let GPS = { watch: null, marca: null, circulo: null, centrado: false, ultima: null };
function textoPosicion(pos) {
  if (!MAPA) return "";
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;
  const r = kmDePosicion(MAPA.eje, lat, lon);
  if (r.dist > LEJOS_DEL_EJE_M) return `Fuera del canal (a ${(r.dist / 1000).toLocaleString("es-UY", { maximumFractionDigits: 1 })} km del eje) · ±${Math.round(accuracy)} m`;
  const t = tramoDeKm(ultimos?.tramos, r.km);
  return `km ${kmTxt(r.km)}${t ? ` · ${t.nombre}` : ""} · ±${Math.round(accuracy)} m`;
}
function mostrarPosicion(pos) {
  if (!MAPA) return;
  const ll = [pos.coords.latitude, pos.coords.longitude];
  GPS.ultima = pos;
  if (!GPS.marca) {
    GPS.circulo = L.circle(ll, { radius: pos.coords.accuracy, color: varCss("--acento"), weight: 1, fillOpacity: 0.12, interactive: false }).addTo(MAPA.map);
    GPS.marca = L.marker(ll, { icon: L.divIcon({ className: "yo", html: '<span class="yo-punto"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 2000, keyboard: false }).addTo(MAPA.map);
  } else { GPS.marca.setLatLng(ll); GPS.circulo.setLatLng(ll).setRadius(pos.coords.accuracy); }
  if (!GPS.centrado) { MAPA.map.setView(ll, Math.max(MAPA.map.getZoom(), 13)); GPS.centrado = true; }
  const el = document.getElementById("mapa-pos"); el.hidden = false; el.textContent = textoPosicion(pos);
}
function errorPosicion(e) {
  const el = document.getElementById("mapa-pos"); el.hidden = false;
  el.textContent = e.code === 1 ? "Sin permiso para usar el GPS (se cambia en los ajustes del navegador)." : e.code === 3 ? "Buscando GPS…" : "No se pudo obtener la posición.";
  if (e.code === 1) { guardarLocal("gps_activado", false); detenerGps(); }
}
function iniciarGps() {
  if (!("geolocation" in navigator)) { errorPosicion({ code: 2 }); return; }
  if (GPS.watch != null) { if (GPS.ultima && MAPA) MAPA.map.setView([GPS.ultima.coords.latitude, GPS.ultima.coords.longitude]); return; } // ya andaba: centrar
  GPS.centrado = false;
  GPS.watch = navigator.geolocation.watchPosition(mostrarPosicion, errorPosicion, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  guardarLocal("gps_activado", true);
  document.getElementById("btn-gps")?.classList.add("activo");
  const el = document.getElementById("mapa-pos"); el.hidden = false; el.textContent = "Buscando GPS…";
}
function detenerGps() {
  if (GPS.watch != null) navigator.geolocation.clearWatch(GPS.watch);
  GPS.watch = null; GPS.centrado = false;
  document.getElementById("btn-gps")?.classList.remove("activo");
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
      MAPA = { map, capa: L.layerGroup().addTo(map), eje: ejeCanal(ss) };
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
  // Fondeaderos (marcados por km: estan fuera del canal)
  const FONDEOS = [[124.5, 130.2, "Fondeadero (uso normal)"], [137.3, 141.4, "Fondeadero (uso normal)"], [108.3, 109.2, "Fondeadero de emergencia · Canal del Infierno, veril rojo"], [84.7, 85.7, "Fondeadero de emergencia · Pozos de San Juan, veril rojo (7,15 m)"]];
  for (const [a, b, txt] of FONDEOS) L.marker(enKm(eje, (a + b) / 2), { icon: L.divIcon({ className: `fondeo-et ${/emergencia/.test(txt) ? "emerg" : ""}`, html: "⚓", iconSize: [26, 26] }) })
    .bindPopup(`<strong>${esc(txt)}</strong><br>km ${kmTxt(a)}–${kmTxt(b)} · fuera del canal (marcado por km)<br><small>REMAGA 2019, art. 2.13</small>`).addTo(capa);
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
    <div class="ley-fila"><span><i class="ley-linea" style="background:${COLOR.verde}"></i>agua: verde / amarillo / rojo según tu calado</span><span>${gc ? `<i class="ley-linea ancha"></i>zonas de cruce de tu eslora (${n0(aj.eslora ?? 0)} m)` : "Cargá la eslora para ver tus zonas de cruce"}</span><span>⚓ fondeaderos (por km)</span></div>
    ${u.revisar.length ? `<h3 class="sub">Novedades para revisar (no se unieron solas)</h3><ul class="reglas">${u.revisar.map((x) => `<li>Nº ${esc(x.n.clave)} · ${esc(x.n.estado ?? "")} — ${esc(x.motivo)}</li>`).join("")}</ul>` : ""}
    ${u.sinPosicion.length ? `<h3 class="sub">Novedades sin posición en el mapa</h3><ul class="reglas">${u.sinPosicion.map((x) => `<li>Nº ${esc(x.n.clave)} · km ${kmTxt(x.n.km)} · ${esc((x.n.descripcion ?? "").replace(/\s*KM\s*[\d.,]+/i, "").toLowerCase())} · <strong>${esc(x.n.estado ?? "")}</strong> — ${esc(x.motivo)}</li>`).join("")}</ul>` : ""}
    <p class="nota">Señales: planilla de la CARP (km, tipo, color, posición y destello). Fondo: © OpenStreetMap. Referencia, no oficial.</p>`;
}
