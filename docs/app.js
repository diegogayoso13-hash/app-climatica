// App Canal Martin Garcia: solo LEE de Supabase (clave publica, sin permiso de escritura).
const SUPABASE_URL = "https://yoxioyszauoaqiwqrpae.supabase.co";
const SUPABASE_KEY = "sb_publishable_vMJL1gkw0u3zBAbJODQNpw_TS0avBJi";
const VIEJO_MIN = 20;             // minutos sin dato para considerar una lectura vieja
const REFRESCO_MS = 2 * 60 * 1000; // se actualiza cada 2 minutos con la app abierta
const TZ = "America/Montevideo";

// ---------- limites de colores (se guardan en el celular) ----------
const DEFECTO = { vAmar: 16, vNar: 22, vRojo: 34, gAmar: 25, gRojo: 34, rioMin: null };
const MARGEN_RIO = 0.2; // amarillo hasta 0,2 m por encima del minimo
const leerLocal = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const guardarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
let lim = { ...DEFECTO, ...(leerLocal("limites") ?? {}) };

const colorViento = (v) => v == null ? "" : v >= lim.vRojo ? "c-rojo" : v >= lim.vNar ? "c-naranja" : v >= lim.vAmar ? "c-amarillo" : "c-verde";
const colorRafaga = (g) => g == null ? "" : g >= lim.gRojo ? "c-rojo" : g >= lim.gAmar ? "c-amarillo" : "c-verde";
// Solo minimo: rojo por debajo, amarillo hasta 0,2 m por encima, verde mas arriba. Sin minimo cargado: sin color.
const colorRio = (m) => {
  if (m == null || lim.rioMin == null) return "";
  if (m < lim.rioMin) return "c-rojo";
  if (m < lim.rioMin + MARGEN_RIO) return "c-amarillo";
  return "c-verde";
};

// ---------- formato ----------
const fmtHora = new Intl.DateTimeFormat("es-UY", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtDia = new Intl.DateTimeFormat("es-UY", { timeZone: TZ, weekday: "short", day: "numeric" });
const fmtFechaHora = new Intl.DateTimeFormat("es-UY", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hora = (ts) => fmtHora.format(new Date(ts));
const minutosDesde = (ts) => (Date.now() - new Date(ts).getTime()) / 60000;
const hace = (ts) => {
  const m = Math.round(minutosDesde(ts));
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `hace ${h} h ${m % 60} min` : `hace ${Math.floor(h / 24)} d`;
};
const esViejo = (ts) => !ts || minutosDesde(ts) > VIEJO_MIN;
const n1 = (x) => x == null ? "–" : (Math.round(x * 10) / 10).toLocaleString("es-UY", { useGrouping: false });
const n0 = (x) => x == null ? "–" : String(Math.round(x));
const m2 = (x) => x == null ? "–" : x.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Direccion: criterio meteorologico (DE DONDE viene el viento). La flecha apunta HACIA DONDE sopla.
const PUNTOS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
const cardinal = (d) => PUNTOS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const dirTexto = (d) => d == null ? "sin dirección" : `de ${cardinal(d)} ${n0(d)}°`;
const flecha = (d, clase = "flecha") => d == null ? "" :
  `<svg class="${clase}" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${(d + 180) % 360}deg)">` +
  `<path d="M12 2 L19 20 L12 15.5 L5 20 Z" fill="currentColor"/></svg>`;

const tendencia = (act, ant, umbral) => {
  if (act == null || ant == null) return "";
  const d = act - ant;
  if (Math.abs(d) < umbral) return `<span class="tend" title="igual">=</span>`;
  return d > 0 ? `<span class="tend" title="sube">▲</span>` : `<span class="tend" title="baja">▼</span>`;
};

// ---------- datos ----------
async function api(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { headers: { apikey: SUPABASE_KEY }, cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function bajarTodo() {
  const ahora = new Date().toISOString();
  const hace7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const hace30d = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [estaciones, ultimas, pronostico, alertas, fuentes, config, novedades, pdfs, l24, pron6, errores] = await Promise.all([
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
  ]);
  return { estaciones, ultimas, pronostico, alertas, fuentes, config, novedades, pdfs, l24, pron6, errores };
}

// Ultima y anterior de cada estacion por tipo
function indexar(ultimas) {
  const ix = {};
  for (const l of ultimas) {
    ix[l.estacion] ??= {};
    (ix[l.estacion][l.tipo] ??= []).push(l);
  }
  for (const e of Object.values(ix)) for (const t of Object.values(e)) t.sort((a, b) => b.ts.localeCompare(a.ts));
  return ix;
}

// ---------- pantalla ----------
function render(d) {
  const ix = indexar(d.ultimas);
  const nombre = Object.fromEntries(d.estaciones.map((e) => [e.id, e.nombre]));
  renderPrincipal(ix, d.pron6 ?? []);
  renderMarea(d.l24 ?? []);
  renderRealVsPron(d.l24 ?? [], d.pron6 ?? [], d.errores ?? []);
  renderCanal(d);
  renderOtras(ix, nombre);
  renderPronostico(d.pronostico, d.config);
  renderAlertas(d.alertas, d.fuentes);
  renderFuentes(d.fuentes);
}

// ---------- pronostico "6 h antes" por hora: promedio, minimo y maximo de los modelos ----------
const promedio = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const dirMedia = (ds) => ds.length ? (Math.atan2(promedio(ds.map((x) => Math.sin(x * Math.PI / 180))), promedio(ds.map((x) => Math.cos(x * Math.PI / 180)))) * 180 / Math.PI + 360) % 360 : null;
function pronPorHora(pron6) {
  const m = new Map();
  for (const f of pron6) (m.get(f.hora) ?? m.set(f.hora, []).get(f.hora)).push(f);
  return [...m.entries()].map(([hora, fs]) => {
    const vs = fs.map((f) => f.viento_kn).filter((x) => x != null);
    const gs = fs.map((f) => f.rafaga_kn).filter((x) => x != null);
    return { t: new Date(hora).getTime(), v: promedio(vs), vMin: Math.min(...vs), vMax: Math.max(...vs), g: promedio(gs),
      dir: dirMedia(fs.map((f) => f.dir_grados).filter((x) => x != null)), modelos: fs.map((f) => f.modelo) };
  }).sort((a, b) => a.t - b.t);
}

// ---------- grafico de lineas en SVG (sin librerias) ----------
// series: [{ nombre, puntos: [[t, v]], clase: "s1"|"s2", ancho, punteada, cortarMin }]
// banda: { puntos: [[t, lo, hi]] } ; zonas: [{ y0, y1, clase }]
const G = { W: 360, H: 190, iz: 34, de: 8, ar: 8, ab: 22 };
function grafico(cont, lectura, { series, banda, zonas = [], t0, t1, fmtV }) {
  const todos = series.flatMap((s) => s.puntos.map((p) => p[1])).concat(banda ? banda.puntos.flatMap((p) => [p[1], p[2]]) : []).filter((x) => x != null);
  if (!todos.length) { cont.innerHTML = `<p class="nota">Sin datos en las últimas 24 h.</p>`; return; }
  // La escala incluye el limite de las zonas (por ejemplo, tu minimo del rio) para que se vea la linea de corte.
  const limites = zonas.flatMap((z) => [z.y0, z.y1]).filter((x) => x != null);
  let y0 = Math.min(...todos, ...limites);
  let y1 = Math.max(...todos, ...limites);
  const pad = Math.max((y1 - y0) * 0.1, 0.05); y0 -= pad; y1 += pad;
  const X = (t) => G.iz + (t - t0) / (t1 - t0) * (G.W - G.iz - G.de);
  const Y = (v) => G.ar + (1 - (v - y0) / (y1 - y0)) * (G.H - G.ar - G.ab);
  const camino = (pts, cortar) => {
    let d = "", ant = null;
    for (const [t, v] of pts) {
      if (v == null) { ant = null; continue; }
      d += `${ant == null || t - ant > cortar ? "M" : "L"}${X(t).toFixed(1)},${Y(v).toFixed(1)}`;
      ant = t;
    }
    return d;
  };
  let svg = `<svg viewBox="0 0 ${G.W} ${G.H}" role="img" aria-label="gráfico">`;
  for (const z of zonas) {
    const a = Math.max(z.y0 ?? y0, y0), b = Math.min(z.y1 ?? y1, y1);
    if (b > a) svg += `<rect x="${G.iz}" width="${G.W - G.iz - G.de}" y="${Y(b)}" height="${Y(a) - Y(b)}" style="fill:${z.relleno};stroke:none"/>`;
  }
  // grilla y ejes
  // Marcas redondas en el eje vertical (1, 2, 2,5 o 5 por potencia de 10)
  const bruto = (y1 - y0) / 4, pot = 10 ** Math.floor(Math.log10(bruto));
  const pasoY = [1, 2, 2.5, 5, 10].map((k) => k * pot).find((k) => k >= bruto);
  for (let v = Math.ceil(y0 / pasoY) * pasoY; v <= y1; v += pasoY) {
    svg += `<line class="eje" x1="${G.iz}" x2="${G.W - G.de}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${G.iz - 4}" y="${Y(v) + 3}" text-anchor="end">${fmtV(Math.round(v / pasoY) * pasoY)}</text>`;
  }
  const paso = 3 * 3600e3;
  for (let t = Math.ceil(t0 / paso) * paso; t <= t1; t += paso) {
    const h = hora(t).slice(0, 2);
    svg += `<line class="eje" x1="${X(t)}" x2="${X(t)}" y1="${G.ar}" y2="${G.H - G.ab}" style="opacity:.5"/><text x="${X(t)}" y="${G.H - 6}" text-anchor="middle">${h}h</text>`;
  }
  if (banda?.puntos.length) {
    const pb = banda.puntos.filter((p) => p[1] != null);
    const arriba = pb.map(([t, , hi]) => `${X(t).toFixed(1)},${Y(hi).toFixed(1)}`);
    const abajo = pb.slice().reverse().map(([t, lo]) => `${X(t).toFixed(1)},${Y(lo).toFixed(1)}`);
    svg += `<polygon points="${arriba.concat(abajo).join(" ")}" style="fill:var(--serie2-banda);stroke:none"/>`;
  }
  for (const s of series) {
    svg += `<path d="${camino(s.puntos, s.cortarMin * 60000)}" fill="none" style="stroke:var(--serie${s.clase === "s2" ? 2 : 1});stroke-width:${s.ancho ?? 2};stroke-linecap:round;stroke-linejoin:round${s.punteada ? ";stroke-dasharray:5 4" : ""}"/>`;
  }
  svg += `<line class="cruz" id="cruz" x1="0" x2="0" y1="${G.ar}" y2="${G.H - G.ab}" style="display:none"/></svg>`;
  cont.innerHTML = svg;

  // Lectura al tocar o pasar el dedo: el valor mas cercano de cada serie
  const el = cont.querySelector("svg");
  const cruz = el.querySelector("#cruz");
  const mover = (ev) => {
    const r = el.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * G.W;
    const t = t0 + (x - G.iz) / (G.W - G.iz - G.de) * (t1 - t0);
    if (t < t0 || t > t1) return;
    cruz.setAttribute("x1", X(t)); cruz.setAttribute("x2", X(t)); cruz.style.display = "";
    const partes = series.map((s) => {
      let mejor = null;
      for (const p of s.puntos) if (p[1] != null && (!mejor || Math.abs(p[0] - t) < Math.abs(mejor[0] - t))) mejor = p;
      return mejor && Math.abs(mejor[0] - t) < s.cortarMin * 60000 ? `${s.nombre} ${fmtV(mejor[1])} (${hora(mejor[0])})` : `${s.nombre} sin dato`;
    });
    lectura.textContent = partes.join(" · ");
  };
  el.addEventListener("pointermove", mover);
  el.addEventListener("pointerdown", mover);
}

// Linea en la tarjeta de Norden: que decia el pronostico (hecho 6 h antes) para la hora de la ultima lectura.
function comparacionAhora(w, pron6) {
  const ph = pronPorHora(pron6);
  const ref = w && !esViejo(w.ts) ? new Date(w.ts).getTime() : Date.now();
  const p = ph.reduce((mej, x) => (!mej || Math.abs(x.t - ref) < Math.abs(mej.t - ref) ? x : mej), null);
  if (!p || Math.abs(p.t - ref) > 45 * 60000) return `<div class="comparacion nota">Pronóstico hecho 6 h antes: todavía sin datos para esta hora.</div>`;
  const rango = p.modelos.length > 1 ? ` (${n0(p.vMin)}–${n0(p.vMax)})` : "";
  let dif = "";
  if (w && !esViejo(w.ts) && w.viento_kn != null && p.v != null) {
    const d = w.viento_kn - p.v;
    dif = Math.abs(d) < 0.5 ? " → <strong>real igual al pronóstico</strong>"
      : ` → <strong>real ${n1(Math.abs(d))} kn ${d > 0 ? "por encima" : "por debajo"}</strong>`;
  }
  return `<div class="comparacion">Pronóstico (hecho 6 h antes) para las ${hora(p.t).slice(0, 2)} h: <strong>${n0(p.v)} kn</strong>${rango} · ráfaga ${n0(p.g)} · ${p.dir == null ? "" : `de ${cardinal(p.dir)}`}${dif}
    <span class="nota">· ${p.modelos.length} de 3 modelos</span></div>`;
}

// ---------- marea 24 h ----------
const ESTACIONES_MAREA = { colonia: "Colonia", conchillas: "Conchillas", carmelo: "Carmelo" };
let mareaExtra = leerLocal("marea_extra");
let ultimosL24 = [];
function renderMarea(l24) {
  ultimosL24 = l24;
  const t1 = Date.now(), t0 = t1 - 24 * 3600e3;
  const serie = (id) => l24.filter((l) => l.estacion === id && l.marea_m != null).map((l) => [new Date(l.ts).getTime(), l.marea_m]);
  const series = [{ nombre: "Norden", puntos: serie("norden"), clase: "s1", ancho: 2.5, cortarMin: 20 }];
  if (mareaExtra) series.push({ nombre: ESTACIONES_MAREA[mareaExtra], puntos: serie(mareaExtra), clase: "s2", ancho: 1.5, punteada: true, cortarMin: 20 });
  const zonas = lim.rioMin == null ? [] : [
    { y0: null, y1: lim.rioMin, relleno: "var(--rojo-fondo)" },
    { y0: lim.rioMin, y1: lim.rioMin + MARGEN_RIO, relleno: "var(--amarillo-fondo)" },
  ];
  document.getElementById("marea-botones").innerHTML = Object.entries(ESTACIONES_MAREA).map(([id, n]) =>
    `<button type="button" data-marea="${id}" aria-pressed="${mareaExtra === id}">+ ${n}</button>`).join("");
  document.getElementById("marea-lectura").textContent = "Tocá el gráfico para ver cada valor.";
  grafico(document.getElementById("marea-grafico"), document.getElementById("marea-lectura"), { series, zonas, t0, t1, fmtV: (v) => m2(v) });
  document.getElementById("marea-leyenda").innerHTML =
    `<span><i style="background:var(--serie1)"></i>Norden</span>` +
    (mareaExtra ? `<span style="color:var(--serie2)"><i class="punteada"></i><span style="color:var(--suave)">${ESTACIONES_MAREA[mareaExtra]}</span></span>` : "") +
    (lim.rioMin != null ? `<span>Rojo: debajo de tu mínimo (${m2(lim.rioMin)} m) · amarillo: hasta +0,2 m</span>` : "") +
    `<span>Línea cortada = sin datos</span>`;
}
document.getElementById("marea-botones").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-marea]");
  if (!b) return;
  mareaExtra = mareaExtra === b.dataset.marea ? null : b.dataset.marea;
  guardarLocal("marea_extra", mareaExtra);
  renderMarea(ultimosL24);
});

// ---------- real contra pronostico ----------
function renderRealVsPron(l24, pron6, errores) {
  const t1 = Date.now(), t0 = t1 - 24 * 3600e3;
  const real = l24.filter((l) => l.estacion === "norden" && l.viento_kn != null).map((l) => [new Date(l.ts).getTime(), l.viento_kn]);
  const ph = pronPorHora(pron6).filter((p) => p.t >= t0 && p.t <= t1);
  grafico(document.getElementById("rvp-grafico"), document.getElementById("rvp-lectura"), {
    t0, t1, fmtV: (v) => n1(v),
    series: [
      { nombre: "Real", puntos: real, clase: "s1", ancho: 2, cortarMin: 20 },
      { nombre: "Pronóstico", puntos: ph.map((p) => [p.t, p.v]), clase: "s2", ancho: 2, cortarMin: 65 },
    ],
    banda: { puntos: ph.filter((p) => p.modelos.length > 1).map((p) => [p.t, p.vMin, p.vMax]) },
  });
  const horasConPron = ph.length;
  document.getElementById("rvp-leyenda").innerHTML =
    `<span><i style="background:var(--serie1)"></i>Real (Norden, nudos)</span>` +
    `<span><i style="background:var(--serie2)"></i>Pronóstico (promedio)</span>` +
    `<span><i class="banda"></i>Margen entre modelos</span>` +
    (horasConPron < 20 ? `<span>Por ahora hay pronóstico para ${horasConPron} de las últimas 24 h (se empezó a guardar el 16/11).</span>` : "");

  // Ranking de modelos con el resumen diario (pronosticos de 0 a 24 h de anticipacion)
  const NOM = { ecmwf: "ECMWF", gfs: "GFS", icon: "ICON", promedio: "Promedio de los 3" };
  const desde7 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const resumen = (filas) => {
    const n = filas.reduce((s, f) => s + f.horas_comparadas, 0);
    if (!n) return null;
    return { n, abs: filas.reduce((s, f) => s + f.error_abs_medio * f.horas_comparadas, 0) / n, ses: filas.reduce((s, f) => s + f.error_medio * f.horas_comparadas, 0) / n };
  };
  const dias = new Set(errores.map((e) => e.dia)).size;
  const filas = Object.keys(NOM).map((m) => ({ m, d7: resumen(errores.filter((e) => e.modelo === m && e.dia >= desde7)), d30: resumen(errores.filter((e) => e.modelo === m)) }));
  const mejor = filas.filter((f) => f.d30).sort((a, b) => a.d30.abs - b.d30.abs)[0]?.m;
  const celda = (r) => r ? `${n1(r.abs)} kn <small class="nota">(${r.ses >= 0 ? "+" : ""}${n1(r.ses)})</small>` : "–";
  document.getElementById("ranking").innerHTML = !errores.length
    ? `<p class="nota">Todavía no hay días completos para comparar. El primer resumen se arma esta madrugada a las 3:30.</p>`
    : `${dias < 3 ? `<p class="nota"><strong>Todavía pocos datos (${dias} día${dias > 1 ? "s" : ""}).</strong> No sacar conclusiones hasta tener al menos una semana.</p>` : ""}
      <table class="ranking"><thead><tr><th>Modelo</th><th>Últimos 7 días</th><th>Últimos 30 días</th></tr></thead><tbody>
      ${filas.map((f) => `<tr class="${f.m === mejor && dias >= 3 ? "mejor" : ""}"><td>${NOM[f.m]}${f.m === mejor && dias >= 3 ? " ✓" : ""}</td><td>${celda(f.d7)}</td><td>${celda(f.d30)}</td></tr>`).join("")}
      </tbody></table>
      <p class="nota">Error promedio del viento medio en Norden, pronósticos de hasta 24 h. Entre paréntesis: + se pasa, − se queda corto.</p>`;
}

function renderPrincipal(ix, pron6 = []) {
  // Norden SIEMPRE arriba con su propio dato (en gris si es viejo).
  const [w, wAnt] = ix.norden?.viento ?? [];
  const [m, mAnt] = ix.norden?.marea ?? [];
  const vientoViejo = esViejo(w?.ts);

  // Respaldo en una linea aparte, debajo: Colonia (CARP) y, si tambien esta vieja, Colonia (Armada).
  let respaldo = "";
  if (vientoViejo) {
    const [c] = ix.colonia?.viento ?? [];
    const [a] = ix.colonia_armada?.viento ?? [];
    if (!esViejo(c?.ts)) {
      respaldo = `<div class="respaldo"><strong>Respaldo: Colonia (CARP)</strong> · ${hora(c.ts)}<br>
        <span class="chip ${colorViento(c.viento_kn)}">${n1(c.viento_kn)} kn</span>
        ráfaga <span class="chip ${colorRafaga(c.rafaga_kn)}">${n1(c.rafaga_kn)} kn</span>
        ${flecha(c.dir_grados, "flecha-chica")} ${dirTexto(c.dir_grados)}</div>`;
    } else if (!esViejo(a?.ts)) {
      respaldo = `<div class="respaldo"><strong>Respaldo: Colonia (Armada, en tierra, sin ráfagas)</strong> · ${hora(a.ts)}<br>
        <span class="chip ${colorViento(a.viento_kn)}">${n1(a.viento_kn)} kn</span>
        ${flecha(a.dir_grados, "flecha-chica")} ${dirTexto(a.dir_grados)}</div>`;
    } else {
      respaldo = `<div class="respaldo">Sin respaldo reciente: Colonia (CARP) y Colonia (Armada) también sin dato nuevo.</div>`;
    }
  }

  document.getElementById("principal").innerHTML = `
    <div class="principal-cab">
      <h2>Pilote Norden</h2>
      <span class="hora">${w ? `Viento ${hora(w.ts)} · ${hace(w.ts)}` : "Sin datos de viento"}</span>
    </div>
    ${vientoViejo ? `<div class="aviso aviso-amarillo" style="margin:8px 0 0">Norden sin dato nuevo desde ${w ? `${hora(w.ts)} (${hace(w.ts)})` : "hace mucho"}</div>` : ""}
    <div class="datos ${vientoViejo ? "viejo" : ""}">
      <div class="dato ${vientoViejo ? "" : colorViento(w?.viento_kn)}">
        <div class="et">Viento medio</div>
        <div class="val">${n1(w?.viento_kn)} <small>kn</small>${tendencia(w?.viento_kn, wAnt?.viento_kn, 0.5)}</div>
      </div>
      <div class="dato ${vientoViejo ? "" : colorRafaga(w?.rafaga_kn)}">
        <div class="et">Ráfaga</div>
        <div class="val">${n1(w?.rafaga_kn)} <small>kn</small>${tendencia(w?.rafaga_kn, wAnt?.rafaga_kn, 0.5)}</div>
      </div>
      <div class="dato ancho">
        ${flecha(w?.dir_grados)}
        <div><div class="et">Dirección (de dónde viene)</div><div class="dir-texto">${dirTexto(w?.dir_grados)}</div></div>
      </div>
    </div>
    ${respaldo}
    ${comparacionAhora(w, pron6)}
    <div class="datos ${esViejo(m?.ts) ? "viejo" : ""}">
      <div class="dato ancho ${colorRio(m?.marea_m)}">
        <div style="flex:1">
          <div class="et">Altura del río (Norden, LIMB)</div>
          <div class="val">${m2(m?.marea_m)} <small>m</small>${tendencia(m?.marea_m, mAnt?.marea_m, 0.005)}</div>
        </div>
        <div class="hora">${m ? `${hora(m.ts)}<br>${hace(m.ts)}` : "sin dato"}</div>
      </div>
    </div>`;
}

// ---------- novedades del Canal Martin Garcia (SOHMA) ----------
const TRAMOS = {
  "BARRA DEL FARALLON": "Barra del Farallón", "PASO DEL FARALLON": "Paso del Farallón", "BARRA DE SAN PEDRO": "Barra de San Pedro",
  "PASO DE SAN JUAN": "Paso de San Juan", "POZOS DE SAN JUAN": "Pozos de San Juan", "CANAL NUEVO": "Canal Nuevo",
  "CANAL DEL INFIERNO": "Canal del Infierno", "CANAL DEL ESTE": "Canal del Este", "CANAL PRINCIPAL": "Canal Principal",
  "CANAL INTERMEDIO": "Canal Intermedio (otro kilometraje)",
};
const tramoLindo = (t) => TRAMOS[t] ?? (t ? t.charAt(0) + t.slice(1).toLowerCase() : "");
// Color por estado: falta rojo; corrida/averiada/retirada naranja; apagada/luz no confiable/AIS amarillo.
const colorEstado = (e = "") =>
  /FALTA|HUNDIDA|DESTRUIDA/.test(e) ? "c-rojo"
    : /CORRIDA|AVERIADA|RETIRADA|REPOSICIONADA/.test(e) ? "c-naranja"
    : /APAGADA|NO CONFIABLE|AIS|TOPE/.test(e) ? "c-amarillo" : "c-gris";
const fmtDiaHora = (ts) => ts ? fmtFechaHora.format(new Date(ts)) : "?";
// "Visto" = ya aparecio en pantalla y el usuario toco "Ya lo vi". Clave: id + fecha en que aparecio (o se normalizo).
const claveVista = (n) => `${n.id}|${n.normalizada_en ? "N" + n.normalizada_en : n.primera_vez}`;
const vistas = () => new Set(leerLocal("canal_vistas") ?? []);
// Notas propias por senal: NO son datos oficiales, quedan solo en este celular. { "4010": { texto, fecha } }
const notas = () => leerLocal("notas_senal") ?? {};
let ultimosDatosCanal = null;

document.getElementById("canal").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-nota]");
  if (!b) return;
  const senal = b.dataset.nota;
  const todas = notas();
  const texto = prompt(`Tu nota para la señal Nº ${senal} (no oficial, queda en este celular).\nDejala vacía para borrarla.`, todas[senal]?.texto ?? "");
  if (texto === null) return; // cancelo
  if (texto.trim()) todas[senal] = { texto: texto.trim(), fecha: new Date().toISOString() };
  else delete todas[senal];
  guardarLocal("notas_senal", todas);
  if (ultimosDatosCanal) renderCanal(ultimosDatosCanal);
});

function renderCanal(d) {
  ultimosDatosCanal = d;
  const misNotas = notas();
  const cont = document.getElementById("canal");
  const nov = d.novedades ?? [];
  const pdf = (d.pdfs ?? [])[0];
  const sohma = (d.fuentes ?? []).find((f) => f.fuente === "sohma");
  const ahora = Date.now();
  const yaVistas = vistas();

  const activas = nov.filter((n) => !n.normalizada_en);
  const radio = activas.filter((n) => n.tipo === "radioaviso" && (!n.vigente_hasta || new Date(n.vigente_hasta).getTime() > ahora));
  const balizas = activas.filter((n) => n.tipo === "baliza");
  const normalizadas = nov.filter((n) => n.normalizada_en);
  const esNueva = (n) => !yaVistas.has(claveVista(n));
  const etiqueta = (n) => esNueva(n) ? `<span class="nuevo">NUEVO</span>` : "";

  // Avisos sobre la lectura del PDF
  const avisos = [];
  if (!pdf) avisos.push("Todavía no se leyó ningún PDF del SOHMA.");
  else {
    if (!pdf.ok) avisos.push(`El PDF del SOHMA (${esc(pdf.archivo)}) no se pudo leer bien: se muestran las últimas novedades que sí se leyeron.`);
    for (const p of pdf.problemas ?? []) if (/MENCIONAR EL CANAL/.test(p)) avisos.push(esc(p));
  }
  if (sohma?.ultimo_error && (!sohma.ultimo_ok || sohma.ultimo_error > sohma.ultimo_ok)) avisos.push(`Error al revisar el SOHMA: ${esc(sohma.mensaje_error)}`);
  if (sohma?.ultimo_ok && minutosDesde(sohma.ultimo_ok) > 26 * 60) avisos.push(`El robot no pudo revisar el SOHMA desde ${fmtDiaHora(sohma.ultimo_ok)}.`);

  const lista = pdf ? `Balizamiento: aviso del ${esc(pdf.lista_emitido ?? "?")}, vigente hasta ${pdf.lista_vigente_hasta ? fmtDiaHora(pdf.lista_vigente_hasta) : "?"} · PDF ${esc(pdf.archivo)} leído ${fmtDiaHora(pdf.leido_en)}` : "";

  const htmlRadio = radio.length ? radio.map((n) => `
    <details class="radioaviso">
      <summary>${etiqueta(n)}AVUR ${esc(n.clave)} · ${esc(n.descripcion)} <span class="nota">· hasta ${fmtDiaHora(n.vigente_hasta)}</span></summary>
      <p>${esc(n.texto)}</p>
      <p class="nota">Emitido ${esc(n.emitido ?? "?")}${n.anula ? ` · anula ${esc(n.anula)}` : ""} · visto desde ${fmtDiaHora(n.primera_vez)}</p>
    </details>`).join("") : `<p class="nota">Sin radioavisos vigentes para el canal.</p>`;

  const fila = (n, norm = false) => `
    <div class="baliza ${norm ? "normalizada" : ""}">
      <span class="km">${n.km != null ? `km ${String(n.km).replace(".", ",")}` : "–"}</span>
      <span>${etiqueta(n)}Nº ${esc(n.clave)} · ${esc((n.descripcion ?? "").replace(/\s*KM\s*[\d.,]+/i, "").toLowerCase())}
        <small>${esc(tramoLindo(n.tramo))} · ${norm ? `normalizada ${fmtDiaHora(n.normalizada_en)}` : `visto desde ${fmtDiaHora(n.primera_vez)}`}</small></span>
      <span class="estado ${norm ? "c-verde" : colorEstado(n.estado)}">${norm ? "NORMAL" : esc(n.estado)}</span>
      ${misNotas[n.clave]
        ? `<div class="nota-mia">📝 <strong>Tu nota</strong> (${fmtDiaHora(misNotas[n.clave].fecha)}, no oficial): ${esc(misNotas[n.clave].texto)}
             <button type="button" class="btn-nota" data-nota="${esc(n.clave)}">editar</button></div>`
        : `<div class="nota-mia vacia"><button type="button" class="btn-nota" data-nota="${esc(n.clave)}">📝 agregar nota</button></div>`}
    </div>`;

  cont.innerHTML = `
    <h2>Novedades Canal Martín García <small>(SOHMA)</small></h2>
    ${avisos.map((a) => `<div class="aviso aviso-amarillo" style="margin:6px 0">${a}</div>`).join("")}
    <p class="nota">${lista}</p>
    <h3 class="sub">Radioavisos</h3>${htmlRadio}
    <h3 class="sub">Balizamiento (${balizas.length})</h3>
    ${balizas.length ? balizas.map((n) => fila(n)).join("") : `<p class="nota">Sin novedades de balizamiento en el canal.</p>`}
    <h3 class="sub">Normalizadas en los últimos 7 días</h3>
    ${normalizadas.length ? normalizadas.map((n) => fila(n, true)).join("") : `<p class="nota">Ninguna.</p>`}
    <p class="nota">"Visto desde": primer día que el robot lo vio en los avisos del SOHMA (el SOHMA no informa desde cuándo está cada novedad).</p>`;

  // Cartel arriba si hay algo nuevo desde la ultima vez
  const nuevosR = radio.filter(esNueva).length;
  const nuevosB = balizas.filter(esNueva).length;
  const nuevosN = normalizadas.filter(esNueva).length;
  const cartel = document.getElementById("aviso-canal");
  if (nuevosR + nuevosB + nuevosN) {
    const partes = [
      nuevosR && `${nuevosR} radioaviso${nuevosR > 1 ? "s" : ""} nuevo${nuevosR > 1 ? "s" : ""}`,
      nuevosB && `${nuevosB} baliza${nuevosB > 1 ? "s" : ""} con novedad nueva`,
      nuevosN && `${nuevosN} normalizada${nuevosN > 1 ? "s" : ""}`,
    ].filter(Boolean).join(" · ");
    cartel.innerHTML = `<div class="aviso aviso-azul"><span>🔔 Canal Martín García desde tu última visita: ${partes}</span>
      <button type="button" id="btn-visto">Ya lo vi</button></div>`;
    document.getElementById("btn-visto").onclick = () => {
      const s = vistas();
      for (const n of [...radio, ...balizas, ...normalizadas]) s.add(claveVista(n));
      guardarLocal("canal_vistas", [...s].slice(-500));
      renderCanal(d);
    };
  } else {
    cartel.innerHTML = "";
  }
}

function renderOtras(ix, nombre) {
  const filas = ["colonia", "conchillas", "carmelo"].map((id) => {
    const [w, wAnt] = ix[id]?.viento ?? [];
    const [m, mAnt] = ix[id]?.marea ?? [];
    const vv = esViejo(w?.ts), mv = esViejo(m?.ts);
    return `
      <details class="fila">
        <summary>
          <span class="nombre">${esc(nombre[id] ?? id)}<small>${w ? `viento ${hora(w.ts)}` : "sin viento"} · ${m ? `marea ${hora(m.ts)}` : "sin marea"}</small></span>
          <span class="chip ${vv ? "viejo" : colorViento(w?.viento_kn)}">${n0(w?.viento_kn)}<small> kn</small></span>
          <span class="chip ${vv ? "viejo" : colorRafaga(w?.rafaga_kn)}" title="ráfaga">${n0(w?.rafaga_kn)}</span>
          <span class="chip ${mv ? "viejo" : colorRio(m?.marea_m)}">${flecha(w?.dir_grados, "flecha-chica")} ${m2(m?.marea_m)}</span>
        </summary>
        <div class="detalle">
          Viento ${n1(w?.viento_kn)} kn${tendencia(w?.viento_kn, wAnt?.viento_kn, 0.5)} · ráfaga ${n1(w?.rafaga_kn)} kn · ${dirTexto(w?.dir_grados)}
          — ${w ? `${hora(w.ts)} (${hace(w.ts)})` : "sin dato"}<br>
          Marea ${m2(m?.marea_m)} m${tendencia(m?.marea_m, mAnt?.marea_m, 0.005)} — ${m ? `${hora(m.ts)} (${hace(m.ts)})` : "sin dato"}
          ${vv || mv ? `<br><strong>Dato viejo (más de ${VIEJO_MIN} min).</strong>` : ""}
        </div>
      </details>`;
  }).join("");

  const [a, aAnt] = ix.colonia_armada?.ambiente ?? [];
  const [wa] = ix.colonia_armada?.viento ?? [];
  const armada = `
    <details class="fila">
      <summary>
        <span class="nombre">Colonia (Armada)<small>en tierra · ${a ? hora(a.ts) : "sin dato"}</small></span>
        <span class="chip ${esViejo(a?.ts) ? "viejo" : ""}">${n1(a?.presion_hpa)}<small> hPa</small>${tendencia(a?.presion_hpa, aAnt?.presion_hpa, 0.2)}</span>
        <span class="chip ${esViejo(a?.ts) ? "viejo" : ""}">${n1(a?.temp_c)}°</span>
        <span class="chip ${esViejo(a?.ts) ? "viejo" : ""}">${n0(a?.humedad_pct)}%</span>
      </summary>
      <div class="detalle">
        Presión ${n1(a?.presion_hpa)} hPa · temperatura ${n1(a?.temp_c)} °C · humedad ${n0(a?.humedad_pct)} %<br>
        Viento ${n1(wa?.viento_kn)} kn · ${dirTexto(wa?.dir_grados)} (sin ráfagas) — ${a ? `${hora(a.ts)} (${hace(a.ts)})` : "sin dato"}
      </div>
    </details>`;

  document.getElementById("otras").innerHTML = `<h2>Otras estaciones <small>(tocá para ver detalle)</small></h2>
    <p class="nota">Viento medio · ráfaga · dirección y marea (m)</p>${filas}${armada}`;
}

function renderPronostico(filas, config) {
  const punto = config.find((c) => c.clave === "punto_pronostico")?.valor;
  document.getElementById("pron-punto").textContent = punto ? `(${punto.nombre ?? `${punto.lat}, ${punto.lon}`})` : "";
  const modelos = [...new Set(filas.map((f) => f.modelo))].sort();
  const corridas = modelos.map((mo) => {
    const c = filas.find((f) => f.modelo === mo)?.corrida;
    return `${mo.toUpperCase()} ${c ? fmtFechaHora.format(new Date(c)) : "?"}`;
  });
  document.getElementById("pron-info").textContent = modelos.length
    ? `Modelos: ${corridas.join(" · ")} (hora de la corrida, Uruguay)`
    : "Sin pronóstico disponible.";

  const porHora = new Map();
  for (const f of filas) (porHora.get(f.hora) ?? porHora.set(f.hora, []).get(f.hora)).push(f);
  const ahora = Date.now() - 60 * 60 * 1000;
  let diaAnt = "";
  const cols = [...porHora.entries()].filter(([h]) => new Date(h).getTime() >= ahora).map(([h, fs]) => {
    const vs = fs.map((f) => f.viento_kn).filter((x) => x != null);
    const gs = fs.map((f) => f.rafaga_kn).filter((x) => x != null);
    const ds = fs.map((f) => f.dir_grados).filter((x) => x != null);
    const prom = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    const v = prom(vs), g = prom(gs);
    const dir = ds.length ? (Math.atan2(prom(ds.map((x) => Math.sin(x * Math.PI / 180))), prom(ds.map((x) => Math.cos(x * Math.PI / 180)))) * 180 / Math.PI + 360) % 360 : null;
    const tormenta = fs.filter((f) => f.codigo_tiempo >= 95).length;
    const lluvia = prom(fs.map((f) => f.lluvia_mm).filter((x) => x != null));
    const dia = fmtDia.format(new Date(h));
    const nuevo = dia !== diaAnt; diaAnt = dia;
    const t = tormenta ? `<span title="${tormenta} de ${fs.length} modelos dan tormenta">⛈${tormenta}/${fs.length}</span>`
      : lluvia >= 0.1 ? `<span title="lluvia promedio">🌧${n1(lluvia)}</span>` : "";
    return `<div class="col ${nuevo ? "dia-nuevo" : ""}">
      <div class="d">${nuevo ? esc(dia) : ""}</div>
      <div class="h">${hora(h).slice(0, 2)}h</div>
      <div class="v ${colorViento(v)}">${n0(v)}</div>
      <div class="m">${vs.length > 1 ? `${n0(Math.min(...vs))}–${n0(Math.max(...vs))}` : "&nbsp;"}</div>
      <div class="g ${colorRafaga(g)}" title="ráfaga">${n0(g)}</div>
      <div class="m">${gs.length > 1 ? `${n0(Math.min(...gs))}–${n0(Math.max(...gs))}` : "&nbsp;"}</div>
      <div title="${dirTexto(dir)}">${flecha(dir, "flecha-chica")}<div class="m">${dir == null ? "" : cardinal(dir)}</div></div>
      <div class="t">${t}</div>
    </div>`;
  });
  document.getElementById("pronostico").innerHTML = cols.length
    ? `<div class="col" style="text-align:left;font-size:.7rem;color:var(--suave)"><div class="d">&nbsp;</div><div class="h">hora</div><div class="v">viento</div><div class="m">margen</div><div class="g">ráfaga</div><div class="m">margen</div><div>de</div></div>${cols.join("")}`
    : "";
}

const SEVERIDAD = { Minor: ["menor", "c-amarillo"], Moderate: ["moderada", "c-amarillo"], Severe: ["severa", "c-naranja"], Extreme: ["extrema", "c-rojo"] };
function renderAlertas(alertas, fuentes) {
  const smn = fuentes.find((f) => f.fuente === "smn_alertas");
  const pend = smn?.detalle?.pendientes ?? 0;
  const nota = pend > 0 ? `<p class="nota">Todavía revisando avisos del SMN (faltan ${pend}).</p>` : "";
  const html = alertas.map((a) => {
    const [sev, cls] = SEVERIDAD[a.severidad] ?? [a.severidad ?? "", "c-amarillo"];
    const donde = [a.toca_norden && "Norden", a.toca_martin_garcia && "Isla Martín García"].filter(Boolean).join(" y ");
    return `<div class="alerta ${cls}">
      <h3>${esc(a.evento)} <small>(${esc(sev)})</small></h3>
      <div class="nota">Afecta: ${esc(donde)} · desde ${a.desde ? fmtFechaHora.format(new Date(a.desde)) : "?"} hasta ${a.hasta ? fmtFechaHora.format(new Date(a.hasta)) : "?"}</div>
      <div>${esc(a.descripcion ?? "")}</div>
    </div>`;
  }).join("");
  document.getElementById("alertas").innerHTML = (html || `<p>Sin alertas vigentes para la zona.</p>`) + nota;
  document.getElementById("alertas-arriba").innerHTML = alertas.length
    ? `<div class="aviso aviso-rojo">⚠ ${alertas.length === 1 ? "Alerta SMN vigente" : `${alertas.length} alertas SMN vigentes`}: ${esc([...new Set(alertas.map((a) => a.evento))].join(", "))} — ver abajo</div>`
    : "";
}

const NOMBRE_FUENTE = { carp: "CARP (4 estaciones)", armada_colonia: "Armada Colonia", open_meteo: "Open-Meteo", smn_alertas: "Alertas SMN", sohma: "Avisos SOHMA (cada hora)" };
function renderFuentes(fuentes) {
  const filas = fuentes.map((f) => {
    const falla = f.ultimo_error && (!f.ultimo_ok || f.ultimo_error > f.ultimo_ok);
    const viejo = !f.ultimo_ok || minutosDesde(f.ultimo_ok) > (f.fuente === "sohma" ? 90 : VIEJO_MIN);
    return `<li>${falla || viejo ? "⚠" : "✓"} ${esc(NOMBRE_FUENTE[f.fuente] ?? f.fuente)}: ${f.ultimo_ok ? `leída ${hora(f.ultimo_ok)}` : "nunca"}${falla ? ` — error: ${esc(f.mensaje_error)}` : ""}</li>`;
  }).join("");
  document.getElementById("fuentes").innerHTML = `<h2>Estado del robot</h2><ul class="nota" style="padding-left:18px;margin:0">${filas}</ul>`;
}

// ---------- ciclo ----------
async function actualizar() {
  const avisoSenal = document.getElementById("aviso-sin-senal");
  try {
    const d = await bajarTodo();
    guardarLocal("ultimos_datos", { t: Date.now(), d });
    render(d);
    avisoSenal.hidden = true;
    document.getElementById("actualizado").textContent = `Act. ${hora(Date.now())}`;
  } catch (e) {
    const c = leerLocal("ultimos_datos");
    if (c) render(c.d);
    avisoSenal.hidden = false;
    avisoSenal.textContent = c
      ? `Sin señal – mostrando datos guardados de las ${fmtFechaHora.format(new Date(c.t))} (${hace(c.t)}). Pueden estar viejos.`
      : "Sin señal y sin datos guardados todavía.";
    document.getElementById("actualizado").textContent = "Sin señal";
  }
}

// ---------- ajustes ----------
const dlg = document.getElementById("ajustes");
const form = document.getElementById("form-ajustes");
const llenarForm = (v) => { for (const [k, x] of Object.entries(v)) if (form.elements[k]) form.elements[k].value = x ?? ""; };
document.getElementById("btn-ajustes").onclick = () => { llenarForm(lim); dlg.showModal(); };
document.getElementById("btn-defecto").onclick = () => llenarForm(DEFECTO);
dlg.addEventListener("close", () => {
  if (dlg.returnValue !== "guardar") return;
  const nuevo = {};
  for (const k of Object.keys(DEFECTO)) {
    const x = form.elements[k].value.trim();
    nuevo[k] = x === "" ? (DEFECTO[k] === null ? null : DEFECTO[k]) : Number(x);
  }
  lim = nuevo;
  guardarLocal("limites", lim);
  const c = leerLocal("ultimos_datos");
  if (c) render(c.d);
});

// ---------- arranque ----------
const cache = leerLocal("ultimos_datos");
if (cache) render(cache.d);
actualizar();
setInterval(() => { if (document.visibilityState === "visible") actualizar(); }, REFRESCO_MS);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") actualizar(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
