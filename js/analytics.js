/* Una sola etiqueta GA4 para el sitio, independiente de Firebase. */
(() => {
  const measurementId = "G-XNMZEKJHQ9";
  if (
    !["http:", "https:"].includes(location.protocol) ||
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ||
    window.__fdcAnalyticsStarted
  ) return;

  window.__fdcAnalyticsStarted = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", measurementId);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
})();
