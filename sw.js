/* FENÓMENOS — Service Worker (Fase 4)
   Estrategias por origen:
   · Cascarón de la app (HTML/CSS/JS/logo): precache + stale-while-revalidate
     → segunda visita pinta al instante, incluso sin red.
   · Datos propios del robot (raw.githubusercontent/fenomenos-datos):
     stale-while-revalidate — el mapa aparece con lo último conocido y se
     refresca por detrás.
   · APIs de Open-Meteo: red primero (con tiempo límite); si no hay red se
     sirve la copia cacheada MARCADA con X-Fdc-Cached-At para que la app
     muestre honestamente «datos de hace X min» — jamás datos viejos
     disfrazados de frescos.
   · CDN (MapLibre, Ionicons, fuentes): caché primero (inmutables).
   Preparado para avisos push futuros (listener ya cableado). */

const VERSION = "fdc-v4";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const API = `${VERSION}-api`;
const CDN = `${VERSION}-cdn`;

const SHELL_URLS = [
  "app.html",
  "css/app.css",
  "css/style.css",
  "js/app.js",
  "img/logo.png",
  "manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_URLS))
      .catch(() => {}) /* sin red en la instalación: se cachea al usar */
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/* guarda una copia sellada con la hora (para el aviso de datos viejos) */
async function putStamped(cache, req, res) {
  try {
    const body = await res.clone().arrayBuffer();
    const headers = new Headers(res.headers);
    headers.set("X-Fdc-Cached-At", String(Date.now()));
    await cache.put(req, new Response(body, { status: res.status, headers }));
  } catch (_) {}
}

async function staleWhileRevalidate(cacheName, req) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok) putStamped(cache, req, res);
      return res;
    })
    .catch(() => null);
  if (cached) {
    refresh.catch(() => {});
    return cached;
  }
  const fresh = await refresh;
  if (fresh) return fresh;
  return new Response("", { status: 504 });
}

async function networkFirst(cacheName, req, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    if (res && res.ok) putStamped(cache, req, res);
    return res;
  } catch (_) {
    const cached = await cache.match(req);
    if (cached) {
      /* copia vieja MARCADA: la app la anuncia, no la disfraza */
      const headers = new Headers(cached.headers);
      headers.set("X-Fdc-Stale", "1");
      const body = await cached.arrayBuffer();
      return new Response(body, { status: cached.status, headers });
    }
    return new Response("", { status: 504 });
  }
}

async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    return new Response("", { status: 504 });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  /* cascarón propio */
  if (url.origin === self.location.origin) {
    if (
      SHELL_URLS.some((s) => url.pathname.endsWith("/" + s)) ||
      url.pathname.endsWith("/app.html")
    ) {
      e.respondWith(staleWhileRevalidate(SHELL, req));
    }
    return;
  }
  /* datos del robot */
  if (url.hostname === "raw.githubusercontent.com" && url.pathname.includes("/fenomenos-datos/")) {
    e.respondWith(staleWhileRevalidate(DATA, req));
    return;
  }
  /* APIs del tiempo: red primero, copia sellada si no hay red */
  if (url.hostname.endsWith("open-meteo.com")) {
    e.respondWith(networkFirst(API, req, 9000));
    return;
  }
  /* CDN estáticos */
  if (["unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
    e.respondWith(cacheFirst(CDN, req));
  }
});

/* listo para avisos push futuros (la suscripción llegará en otra fase) */
self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {}
  if (d && d.title) {
    e.waitUntil(
      self.registration.showNotification(d.title, {
        body: d.body || "",
        icon: "img/icon-192.png",
        data: d.url ? { url: d.url } : {},
      })
    );
  }
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "app.html";
  e.waitUntil(self.clients.openWindow(url));
});
