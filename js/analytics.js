/* GA4 waits for Google's CMP. Missing/unknown consent never enables analytics.
   Requires Consent Mode enabled in AdSense Privacy & messaging.
   API: https://developers.google.com/funding-choices/fc-api-docs */
(() => {
  const measurementId = "G-92SH61163V";
  if (
    !["http:", "https:"].includes(location.protocol) ||
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ||
    window.__fdcConsentBridgeStarted
  ) return;
  window.__fdcConsentBridgeStarted = true;
  // The Google tag routes to this additional GA4 destination remotely.
  // Keep every connected measurement ID covered when destinations change.
  const measurementIds = [measurementId, "G-XNMZEKJHQ9"];
  const setAnalyticsEnabled = enabled => {
    for (const id of measurementIds) window[`ga-disable-${id}`] = !enabled;
  };
  setAnalyticsEnabled(false);
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  const denied = { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
  window.gtag("consent", "default", denied);
  window.googlefc = window.googlefc || {};
  const cmp = window.googlefc;
  cmp.callbackQueue = cmp.callbackQueue || [];

  cmp.callbackQueue.push({ CONSENT_MODE_DATA_READY: () => {
    // Only invoke CMP methods from its documented callback queue.
    let values;
    try { values = cmp.getGoogleConsentModeValues(); } catch {
      setAnalyticsEnabled(false);
      window.gtag("consent", "update", denied);
      return;
    }
    const statuses = cmp.ConsentModePurposeStatusEnum;
    if (!statuses || !values) {
      setAnalyticsEnabled(false);
      window.gtag("consent", "update", denied);
      return;
    }
    const permitted = value =>
      value !== undefined && (value === statuses.GRANTED || value === statuses.NOT_APPLICABLE);
    const allowed = permitted(values.analyticsStoragePurposeConsentStatus);
    setAnalyticsEnabled(allowed);
    window.gtag("consent", "update", {
      analytics_storage: allowed ? "granted" : "denied",
      ad_storage: permitted(values.adStoragePurposeConsentStatus) ? "granted" : "denied",
      ad_user_data: permitted(values.adUserDataPurposeConsentStatus) ? "granted" : "denied",
      ad_personalization: permitted(values.adPersonalizationPurposeConsentStatus) ? "granted" : "denied",
    });
    if (!allowed || window.__fdcAnalyticsStarted) return;
    window.__fdcAnalyticsStarted = true;
    window.gtag("js", new Date());
    window.gtag("config", measurementId);
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);
  }});

  cmp.callbackQueue.push({ CONSENT_API_READY: () => {
    if (typeof cmp.showRevocationMessage !== "function" || document.getElementById("fdc-privacy-settings")) return;
    const host = document.querySelector('.footer__institutional, nav[aria-label="Información del sitio"], .site-footer');
    if (!host) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "fdc-privacy-settings";
    button.className = "footer__link";
    button.textContent = "Preferencias de privacidad";
    button.style.cssText = "background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;padding:0;text-decoration:underline";
    button.addEventListener("click", () => {
      // Stop analytics while the visitor revisits their choices.
      setAnalyticsEnabled(false);
      window.gtag("consent", "update", denied);
      cmp.callbackQueue.push({ CONSENT_API_READY: () => cmp.showRevocationMessage() });
    });
    host.appendChild(button);
  }});
})();
