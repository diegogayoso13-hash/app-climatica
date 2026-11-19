// Guarda los archivos de la app (pantallas y codigo) para que abra al instante, con o sin señal.
// Los datos NO pasan por aca (vienen de Supabase, otro sitio): se piden frescos siempre y, si son viejos, la app los muestra en gris con su hora.
// Version nueva: al publicar, subir VERSION (y VERSION_APP en app.js, con el mismo numero).
const VERSION = 26;
const CACHE = `tu-faro-v${VERSION}`;
const ARCHIVOS = ["./", "index.html", "estilos.css", "app.js", "manifest.webmanifest", "icono-192.png", "icono-512.png", "icono.svg", "mapa.js", "senales.json", "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css"];

// Instalar: baja TODOS los archivos de nuevo, salteando la memoria del navegador (asi nunca guarda archivos de la version anterior).
// No se activa sola: la app decide cuando (recien abierta sin tocar nada, o cuando tocas el cartel "Hay una versión nueva").
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: "reload" })))));
});
self.addEventListener("message", (e) => { if (e.data === "actualizar") self.skipWaiting(); });

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Archivos propios: lo guardado de ESTA version, al instante (sin esperar a la red). Solo si falta algo, se pide a la red.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) =>
    (await c.match(e.request, { ignoreSearch: true })) ?? (e.request.mode === "navigate" ? await c.match("index.html") : null) ?? fetch(e.request)));
});

// Avisos al celular: el robot de Supabase manda { titulo, cuerpo, ir, tipo } cifrado; aca se muestra.
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { cuerpo: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.titulo || "Tu Faro", {
    body: m.cuerpo || "", icon: "icono-192.png", badge: "icono-192.png", lang: "es-UY",
    tag: m.tipo || "tu-faro", renotify: !m.silencioso, silent: m.silencioso === true, // "en pausa" / "activo de nuevo": sin sonido ni vibracion
    data: { ir: typeof m.ir === "string" ? m.ir : "" },
  }));
});
// Tocar el aviso: abre Tu Faro (o la trae al frente) en la seccion que corresponde.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const ir = /^(sec-[a-z-]+|ajustes)$/.test(e.notification.data?.ir ?? "") ? e.notification.data.ir : "";
  const url = new URL(ir ? `./#ir=${ir}` : "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    if (c) { if (ir) c.postMessage({ ir }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
