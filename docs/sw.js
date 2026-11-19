// Guarda los archivos de la app para que abra sin señal.
// Los datos NO pasan por aca: la app guarda la ultima lectura en el celular y avisa que es vieja.
const CACHE = "tu-faro-v24";
const ARCHIVOS = ["./", "index.html", "estilos.css", "app.js", "manifest.webmanifest", "icono-192.png", "icono-512.png", "icono.svg", "mapa.js", "senales.json", "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Archivos propios: primero la red (para tener siempre la ultima version), si no hay senal, lo guardado.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match("index.html")))
  );
});

// Avisos al celular: el robot de Supabase manda { titulo, cuerpo, ir, tipo } cifrado; aca se muestra.
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { cuerpo: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.titulo || "Tu Faro", {
    body: m.cuerpo || "", icon: "icono-192.png", badge: "icono-192.png", lang: "es-UY",
    tag: m.tipo || "tu-faro", renotify: true, data: { ir: typeof m.ir === "string" ? m.ir : "" },
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
