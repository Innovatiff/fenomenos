/* Service worker mínimo: hace la app instalable (PWA) sin cachear nada —
   los datos del tiempo siempre llegan frescos de la red. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
