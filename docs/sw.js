// Guarda los archivos de la app para que abra sin señal.
// Los datos NO pasan por aca: la app guarda la ultima lectura en el celular y avisa que es vieja.
const CACHE = "canal-mg-v7";
const ARCHIVOS = ["./", "index.html", "estilos.css", "app.js", "manifest.webmanifest", "icono-192.png", "icono-512.png"];

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
