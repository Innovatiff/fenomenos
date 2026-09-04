/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — app.js
   Consola meteorológica sobre MapLibre GL. El pronóstico puntual, los
   riesgos y la capa del mapa piden SIEMPRE models=ecmwf_ifs025 — nunca
   el "best match" multi-modelo. EXCEPCIÓN (decisión del dueño,
   2026-09-04): la sección de ENSAMBLES es multi-sistema a propósito —
   EPS/GEFS/GEPS/ICON/AIFS + súper y grand ensamble — con cada miembro
   etiquetado por su fuente real (ver ENS_SYSTEMS). Datos del robot
   propio (fenomenos-datos) + Open-Meteo; ajustes por usuario
   (localStorage siempre; Firestore users/{uid} si la cuenta no es
   anónima). Requiere sesión: sin usuario se vuelve a acceso.html.
   ══════════════════════════════════════════════════════════════════════════ */

import { app } from "./firebase-init.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

window.__fdcModuleOk = true;

/* ── Registro de red (auditoría): TODA petición y TODO fallo quedan
   anotados en window.__fdcFetchLog (anillo de 300) — nada falla en
   silencio. Los fallos además se avisan por consola. ── */
const fetchLog = [];
window.__fdcFetchLog = fetchLog;
{
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const t0 = performance.now();
    const anota = (entry) => {
      fetchLog.push(entry);
      if (fetchLog.length > 300) fetchLog.shift();
    };
    try {
      const res = await realFetch(input, init);
      anota({ t: Date.now(), url, status: res.status, ms: Math.round(performance.now() - t0) });
      if (!res.ok) console.warn("[red]", res.status, url);
      return res;
    } catch (err) {
      anota({ t: Date.now(), url, error: String(err), ms: Math.round(performance.now() - t0) });
      console.warn("[red] fallo de red:", url, err);
      throw err;
    }
  };
}

const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

/* ═══════════════════════════  1. AJUSTES  ═══════════════════════════════ */

const SETTINGS_KEY = "fdc-app-settings";

const COUNTRIES = {
  do: { name: "República Dominicana", place: "Santo Domingo", lat: 18.4861, lon: -69.9312, zoom: 8 },
  pr: { name: "Puerto Rico", place: "San Juan", lat: 18.4655, lon: -66.1057, zoom: 9 },
  cu: { name: "Cuba", place: "La Habana", lat: 23.1136, lon: -82.3666, zoom: 6 },
  mx: { name: "México", place: "Ciudad de México", lat: 19.4326, lon: -99.1332, zoom: 5 },
  us: { name: "Estados Unidos", place: "Miami", lat: 25.7617, lon: -80.1918, zoom: 6 },
  gt: { name: "Guatemala", place: "Ciudad de Guatemala", lat: 14.6349, lon: -90.5069, zoom: 7 },
  hn: { name: "Honduras", place: "Tegucigalpa", lat: 14.0723, lon: -87.1921, zoom: 7 },
  bz: { name: "Belice", place: "Belmopán", lat: 17.2514, lon: -88.759, zoom: 8 },
  sv: { name: "El Salvador", place: "San Salvador", lat: 13.6929, lon: -89.2182, zoom: 8 },
  ni: { name: "Nicaragua", place: "Managua", lat: 12.1364, lon: -86.2514, zoom: 7 },
  cr: { name: "Costa Rica", place: "San José", lat: 9.9281, lon: -84.0907, zoom: 8 },
  pa: { name: "Panamá", place: "Ciudad de Panamá", lat: 8.9824, lon: -79.5199, zoom: 8 },
};

const DEFAULT_SETTINGS = {
  country: "do",
  tempUnit: "celsius",
  windUnit: "kmh",
  layer: "radar",
  fronts: true,
  globe: true /* proyección globo (MapLibre v5); false = Mercator plano */,
  isobars: false /* isobaras del MSLP del HRES sobre el modelo */,
  lang: "auto" /* i18n: auto = navigator.language; ES/EN/FR/PT/DE/AR */,
};

let settings = { ...DEFAULT_SETTINGS };
let staleStamp = null; /* Date.now() de la copia offline servida por el SW */
let provTitleText = ""; /* procedencia para el hover de cada número */

/* ═══════════════════ i18n (Fase 4) ══════════════════════════════════════
   Arquitectura para MUCHOS idiomas, no una lista quemada: diccionario por
   clave + t() + data-i18n en el HTML. Español primario; se envían
   ES/EN/FR/PT/DE/AR — el árabe prueba que el layout aguanta RTL (dir se
   voltea entero). Autodetección por navigator.language, anulable en
   Ajustes; fechas/números con Intl en el locale activo. Los textos
   analíticos largos (notas del modelo/EPS) siguen en español por ahora:
   hueco documentado, no escondido. */
const LANGS = ["es", "en", "fr", "pt", "de", "ar"];
const RTL_LANGS = new Set(["ar"]);

const I18N = {
  /* — cascarón — */
  search_ph: { es: "Busca una ciudad o lugar…", en: "Search a city or place…", fr: "Cherchez une ville ou un lieu…", pt: "Busque uma cidade ou lugar…", de: "Stadt oder Ort suchen…", ar: "ابحث عن مدينة أو مكان…" },
  search_empty: { es: "Sin resultados para tu búsqueda.", en: "No results for your search.", fr: "Aucun résultat pour votre recherche.", pt: "Sem resultados para sua busca.", de: "Keine Ergebnisse für deine Suche.", ar: "لا نتائج لبحثك." },
  search_fail: { es: "No se pudo buscar. Revisa tu conexión.", en: "Search failed. Check your connection.", fr: "Recherche impossible. Vérifiez votre connexion.", pt: "Não foi possível buscar. Verifique sua conexão.", de: "Suche fehlgeschlagen. Prüfe deine Verbindung.", ar: "تعذّر البحث. تحقق من اتصالك." },
  settings: { es: "Ajustes", en: "Settings", fr: "Réglages", pt: "Ajustes", de: "Einstellungen", ar: "الإعدادات" },
  logout: { es: "Salir", en: "Log out", fr: "Quitter", pt: "Sair", de: "Abmelden", ar: "خروج" },
  /* — capas — */
  layer_map: { es: "Mapa", en: "Map", fr: "Carte", pt: "Mapa", de: "Karte", ar: "خريطة" },
  layer_sat: { es: "Satélite", en: "Satellite", fr: "Satellite", pt: "Satélite", de: "Satellit", ar: "قمر صناعي" },
  layer_clouds: { es: "Nubes", en: "Clouds", fr: "Nuages", pt: "Nuvens", de: "Wolken", ar: "غيوم" },
  layer_none: { es: "Sin capa", en: "No layer", fr: "Sans couche", pt: "Sem camada", de: "Keine Ebene", ar: "بدون طبقة" },
  /* — panel del punto — */
  now_title: { es: "Condiciones actuales", en: "Current conditions", fr: "Conditions actuelles", pt: "Condições atuais", de: "Aktuelle Bedingungen", ar: "الأحوال الحالية" },
  risks_title: { es: "Riesgos · próximas 48 horas", en: "Risks · next 48 hours", fr: "Risques · prochaines 48 h", pt: "Riscos · próximas 48 horas", de: "Risiken · nächste 48 Std.", ar: "المخاطر · الـ48 ساعة القادمة" },
  hours_title: { es: "Próximas horas", en: "Next hours", fr: "Prochaines heures", pt: "Próximas horas", de: "Nächste Stunden", ar: "الساعات القادمة" },
  days_title: { es: "Próximos días", en: "Next days", fr: "Prochains jours", pt: "Próximos dias", de: "Nächste Tage", ar: "الأيام القادمة" },
  updated_at: { es: "Actualizado a las", en: "Updated at", fr: "Mis à jour à", pt: "Atualizado às", de: "Aktualisiert um", ar: "حُدِّث في" },
  updating: { es: "Actualizando…", en: "Updating…", fr: "Mise à jour…", pt: "Atualizando…", de: "Aktualisiere…", ar: "جارٍ التحديث…" },
  offline_data: { es: "Sin conexión — datos de hace", en: "Offline — data from", fr: "Hors ligne — données d'il y a", pt: "Sem conexão — dados de há", de: "Offline — Daten von vor", ar: "بدون اتصال — بيانات منذ" },
  load_fail: { es: "No se pudo cargar el pronóstico.", en: "Could not load the forecast.", fr: "Impossible de charger les prévisions.", pt: "Não foi possível carregar a previsão.", de: "Vorhersage konnte nicht geladen werden.", ar: "تعذّر تحميل التوقعات." },
  /* — losas — */
  st_feels: { es: "Sensación", en: "Feels like", fr: "Ressenti", pt: "Sensação", de: "Gefühlt", ar: "الإحساس" },
  st_humidity: { es: "Humedad", en: "Humidity", fr: "Humidité", pt: "Umidade", de: "Luftfeuchte", ar: "الرطوبة" },
  st_wind: { es: "Viento", en: "Wind", fr: "Vent", pt: "Vento", de: "Wind", ar: "الرياح" },
  st_gusts: { es: "Ráfagas", en: "Gusts", fr: "Rafales", pt: "Rajadas", de: "Böen", ar: "الهبّات" },
  st_pressure: { es: "Presión", en: "Pressure", fr: "Pression", pt: "Pressão", de: "Druck", ar: "الضغط" },
  st_rain: { es: "Lluvia", en: "Rain", fr: "Pluie", pt: "Chuva", de: "Regen", ar: "المطر" },
  st_dew: { es: "Punto de rocío", en: "Dew point", fr: "Point de rosée", pt: "Ponto de orvalho", de: "Taupunkt", ar: "نقطة الندى" },
  st_clouds: { es: "Nubes baja·media·alta", en: "Clouds low·mid·high", fr: "Nuages bas·moy·hauts", pt: "Nuvens baixa·média·alta", de: "Wolken tief·mittel·hoch", ar: "غيوم منخفضة·متوسطة·عالية" },
  st_cape: { es: "CAPE", en: "CAPE", fr: "CAPE", pt: "CAPE", de: "CAPE", ar: "CAPE" },
  st_freezing: { es: "Isoterma 0°", en: "Freezing level", fr: "Isotherme 0°", pt: "Isoterma 0°", de: "Nullgradgrenze", ar: "مستوى التجمد" },
  st_visibility: { es: "Visibilidad", en: "Visibility", fr: "Visibilité", pt: "Visibilidade", de: "Sichtweite", ar: "الرؤية" },
  st_uv: { es: "Índice UV", en: "UV index", fr: "Indice UV", pt: "Índice UV", de: "UV-Index", ar: "مؤشر UV" },
  st_elev: { es: "Altitud del punto", en: "Point elevation", fr: "Altitude du point", pt: "Altitude do ponto", de: "Höhe des Punkts", ar: "ارتفاع النقطة" },
  st_sun: { es: "Sol", en: "Sun", fr: "Soleil", pt: "Sol", de: "Sonne", ar: "الشمس" },
  st_snow: { es: "Nieve (1 h · manto)", en: "Snow (1 h · depth)", fr: "Neige (1 h · manteau)", pt: "Neve (1 h · manto)", de: "Schnee (1 h · Decke)", ar: "الثلج (ساعة · سماكة)" },
  st_t850: { es: "Temp. 850 hPa", en: "Temp 850 hPa", fr: "Temp. 850 hPa", pt: "Temp. 850 hPa", de: "Temp. 850 hPa", ar: "حرارة 850 هكتوباسكال" },
  st_z500: { es: "Altura 500 hPa", en: "Height 500 hPa", fr: "Hauteur 500 hPa", pt: "Altura 500 hPa", de: "Höhe 500 hPa", ar: "ارتفاع 500 هكتوباسكال" },
  st_shear: { es: "Cizalla 850–200", en: "Shear 850–200", fr: "Cisaillement 850–200", pt: "Cisalhamento 850–200", de: "Scherung 850–200", ar: "قص الرياح 850–200" },
  sun_midnight: { es: "Sol de medianoche", en: "Midnight sun", fr: "Soleil de minuit", pt: "Sol da meia-noite", de: "Mitternachtssonne", ar: "شمس منتصف الليل" },
  sun_polar_night: { es: "Noche polar", en: "Polar night", fr: "Nuit polaire", pt: "Noite polar", de: "Polarnacht", ar: "ليل قطبي" },
  /* — mar — */
  marine_title: { es: "Mar · olas del ECMWF (WAM)", en: "Sea · ECMWF waves (WAM)", fr: "Mer · vagues ECMWF (WAM)", pt: "Mar · ondas do ECMWF (WAM)", de: "Meer · ECMWF-Wellen (WAM)", ar: "البحر · أمواج ECMWF" },
  ma_now: { es: "Oleaje ahora", en: "Waves now", fr: "Vagues actuelles", pt: "Ondas agora", de: "Wellen jetzt", ar: "الأمواج الآن" },
  ma_period: { es: "Período", en: "Period", fr: "Période", pt: "Período", de: "Periode", ar: "الفترة" },
  ma_dir: { es: "Dirección", en: "Direction", fr: "Direction", pt: "Direção", de: "Richtung", ar: "الاتجاه" },
  ma_max48: { es: "Máx. 48 h", en: "Max 48 h", fr: "Max 48 h", pt: "Máx. 48 h", de: "Max. 48 Std.", ar: "الأقصى في 48 ساعة" },
  /* — modelo — */
  mode_prob: { es: "Probabilidad", en: "Probability", fr: "Probabilité", pt: "Probabilidade", de: "Wahrscheinlichkeit", ar: "الاحتمال" },
  mode_det: { es: "Determinista", en: "Deterministic", fr: "Déterministe", pt: "Determinista", de: "Deterministisch", ar: "حتمي" },
  mode_p24: { es: "Prob. 24 h", en: "24 h prob.", fr: "Prob. 24 h", pt: "Prob. 24 h", de: "24-h-Wahrsch.", ar: "احتمال 24 س" },
  var_wind: { es: "Viento", en: "Wind", fr: "Vent", pt: "Vento", de: "Wind", ar: "رياح" },
  var_gusts: { es: "Ráfagas", en: "Gusts", fr: "Rafales", pt: "Rajadas", de: "Böen", ar: "هبّات" },
  var_rain: { es: "Lluvia", en: "Rain", fr: "Pluie", pt: "Chuva", de: "Regen", ar: "مطر" },
  var_temp: { es: "Temp.", en: "Temp", fr: "Temp.", pt: "Temp.", de: "Temp.", ar: "حرارة" },
  var_air: { es: "Aire", en: "Air", fr: "Air", pt: "Ar", de: "Luft", ar: "هواء" },
  iso_label: { es: "Isobaras (presión al nivel del mar, hPa — HRES)", en: "Isobars (sea-level pressure, hPa — HRES)", fr: "Isobares (pression au niveau de la mer, hPa — HRES)", pt: "Isóbaras (pressão ao nível do mar, hPa — HRES)", de: "Isobaren (Meeresspiegeldruck, hPa — HRES)", ar: "خطوط الضغط (hPa — HRES)" },
  /* — ciclones (el descargo es CRÍTICO en todos los idiomas) — */
  tc_title: { es: "Ciclones tropicales · ENS de ECMWF", en: "Tropical cyclones · ECMWF ENS", fr: "Cyclones tropicaux · ENS ECMWF", pt: "Ciclones tropicais · ENS do ECMWF", de: "Tropische Wirbelstürme · ECMWF ENS", ar: "الأعاصير المدارية · ECMWF ENS" },
  tc_warn: { es: "Trayectorias del modelo ECMWF — NO es un aviso oficial. Consulta siempre a tu servicio meteorológico nacional.", en: "ECMWF model tracks — NOT an official warning. Always consult your national meteorological service.", fr: "Trajectoires du modèle ECMWF — PAS un avis officiel. Consultez toujours votre service météorologique national.", pt: "Trajetórias do modelo ECMWF — NÃO é um aviso oficial. Consulte sempre seu serviço meteorológico nacional.", de: "ECMWF-Modellbahnen — KEINE amtliche Warnung. Wenden Sie sich stets an Ihren nationalen Wetterdienst.", ar: "مسارات نموذج ECMWF — ليست تحذيرًا رسميًا. راجع دائمًا هيئة الأرصاد الوطنية." },
  /* — país — */
  country_title: { es: "País", en: "Country", fr: "Pays", pt: "País", de: "Land", ar: "البلد" },
  country_met: { es: "Servicio meteorológico oficial ↗", en: "Official meteorological service ↗", fr: "Service météorologique officiel ↗", pt: "Serviço meteorológico oficial ↗", de: "Offizieller Wetterdienst ↗", ar: "هيئة الأرصاد الرسمية ↗" },
  country_nomet: { es: "Sin enlace oficial verificado para este territorio.", en: "No verified official link for this territory.", fr: "Pas de lien officiel vérifié pour ce territoire.", pt: "Sem link oficial verificado para este território.", de: "Kein verifizierter offizieller Link für dieses Gebiet.", ar: "لا رابط رسمي مُتحقق منه لهذا الإقليم." },
  /* — compartir — */
  share: { es: "Compartir", en: "Share", fr: "Partager", pt: "Compartilhar", de: "Teilen", ar: "مشاركة" },
  share_copied: { es: "Enlace copiado.", en: "Link copied.", fr: "Lien copié.", pt: "Link copiado.", de: "Link kopiert.", ar: "تم نسخ الرابط." },
  /* — ajustes — */
  set_lang: { es: "Idioma", en: "Language", fr: "Langue", pt: "Idioma", de: "Sprache", ar: "اللغة" },
  lang_auto: { es: "Automático", en: "Automatic", fr: "Automatique", pt: "Automático", de: "Automatisch", ar: "تلقائي" },
};

/* ═══ enlace profundo + compartir (Fase 4) ═══════════════════════════════
   El estado visible viaja en el hash: capa, variable, modo, período,
   centro/zoom del mapa, punto del panel e idioma. Abrir el enlace
   restaura la vista; el botón Compartir usa Web Share o el portapapeles. */
function parseLink() {
  const out = {};
  try {
    const h = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    if (["radar", "satellite", "clouds", "none"].includes(h.get("l"))) out.layer = h.get("l");
    if (["wind", "gusts", "rain", "temp", "air"].includes(h.get("v"))) out.variable = h.get("v");
    if (["prob", "det", "p24"].includes(h.get("m"))) out.mode = h.get("m");
    const st = parseInt(h.get("s"), 10);
    if (Number.isFinite(st) && st >= 0 && st < 64) out.step = st;
    const c = (h.get("c") || "").split(",").map(Number);
    if (c.length === 3 && c.every(Number.isFinite)) out.center = c; /* lat,lon,zoom */
    const p = (h.get("p") || "").split(",").map(Number);
    if (p.length === 2 && p.every(Number.isFinite)) out.point = p;
    if (LANGS.includes(h.get("lg"))) out.lang = h.get("lg");
  } catch (_) {}
  return out;
}

let linkTimer = null;
function updateLink() {
  clearTimeout(linkTimer);
  linkTimer = setTimeout(() => {
    try {
      const h = new URLSearchParams();
      h.set("l", activeKind);
      h.set("v", euro.variable);
      h.set("m", euro.mode);
      if (euro.step != null) h.set("s", String(euro.step));
      if (map && map.getCenter) {
        const c = map.getCenter();
        h.set("c", `${c.lat.toFixed(3)},${c.lng.toFixed(3)},${(map.getZoom() || 3).toFixed(1)}`);
      }
      if (currentSpot) h.set("p", `${currentSpot.lat.toFixed(3)},${currentSpot.lon.toFixed(3)}`);
      if (settings.lang && settings.lang !== "auto") h.set("lg", settings.lang);
      history.replaceState(null, "", `#${h.toString()}`);
    } catch (_) {}
  }, 400);
}

async function shareLink() {
  updateLink();
  const url = location.href;
  /* imagen estática del estado actual, si el sistema permite adjuntarla */
  let files;
  try {
    const cv = map && map.getCanvas && map.getCanvas();
    if (cv && navigator.canShare) {
      const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
      if (blob) {
        const f = new File([blob], "fenomenos-mapa.png", { type: "image/png" });
        if (navigator.canShare({ files: [f] })) files = [f];
      }
    }
  } catch (_) {}
  try {
    if (navigator.share) {
      await navigator.share(files ? { title: document.title, url, files } : { title: document.title, url });
      return;
    }
  } catch (_) {
    return; /* usuario canceló el diálogo nativo */
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t("share_copied"));
  } catch (_) {
    prompt("URL:", url); /* último recurso, nunca un callejón muerto */
  }
}

function resolveLang() {
  if (settings.lang && settings.lang !== "auto" && LANGS.includes(settings.lang))
    return settings.lang;
  const nav = ((navigator.language || "es").slice(0, 2) || "es").toLowerCase();
  return LANGS.includes(nav) ? nav : "es";
}

let curLang = "es";

function t(key) {
  const e = I18N[key];
  return (e && (e[curLang] || e.es)) || key;
}

/* locale para Intl (fechas/números) según el idioma activo */
function tLocale() {
  return curLang === "es" ? "es" : curLang;
}

function applyI18n() {
  curLang = resolveLang();
  document.documentElement.lang = curLang;
  document.documentElement.dir = RTL_LANGS.has(curLang) ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}

/* ═══ países GLOBALES (generados por el robot: NE admin-0 + GeoNames) ═══
   COUNTRIES de arriba queda como arranque instantáneo y respaldo; en
   cuanto geo/countries.json llega, el selector cubre TODOS los estados y
   territorios. El Caribe solo es el valor de marca por defecto. */
let worldCountries = null; /* a2 → entrada normalizada */
let worldCountriesPromise = null;

function countryGet(code) {
  return (worldCountries && worldCountries[code]) || COUNTRIES[code] || null;
}

async function loadCountries() {
  if (worldCountriesPromise) return worldCountriesPromise;
  worldCountriesPromise = (async () => {
    try {
      const res = await fetch(`${DATA_REPO}/geo/countries.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (!d || !Array.isArray(d.countries) || d.countries.length < 100)
        throw new Error("countries.json incompleto");
      const map = {};
      for (const c of d.countries) {
        map[c.a2] = {
          name: c.name.es || c.name.en || c.a2,
          place: c.capital ? c.capital[0] : c.name.es || c.name.en,
          lat: c.capital ? c.capital[1] : c.centroid[0],
          lon: c.capital ? c.capital[2] : c.centroid[1],
          zoom: c.zoom,
          bbox: c.bbox,
          met: c.met || null,
          top: c.top || [],
          type: c.type || "",
          tz: c.tz || [],
          units: c.units || null,
        };
      }
      worldCountries = map;
      fillCountrySelect();
      countryRender();
    } catch (_) {
      worldCountriesPromise = null; /* reintento en el próximo uso */
    }
    return worldCountries;
  })();
  return worldCountriesPromise;
}

/* panel «País»: capital, ciudades top (clic → pronóstico) y el servicio
   meteorológico oficial SOLO si el robot lo verificó en vivo */
function countryRender() {
  const block = $("country-block");
  if (!block) return;
  const c = countryGet(settings.country);
  if (!c || !worldCountries || !worldCountries[settings.country]) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  $("country-title").textContent = c.name;
  const cities = (c.top || [])
    .map(
      (t) =>
        `<button class="eps-chip country-city" data-lat="${t[1]}" data-lon="${t[2]}" type="button"><strong>${t[0]}</strong><span>${Math.round(t[3] / 1000)} mil hab.</span></button>`
    )
    .join("");
  $("country-cities").innerHTML = cities || "";
  $("country-met").innerHTML = c.met
    ? `<a href="${c.met}" target="_blank" rel="noopener">${t("country_met")}</a>`
    : `<span>${t("country_nomet")}</span>`;
}

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest && ev.target.closest("#country-cities .country-city");
  if (!btn) return;
  const la = parseFloat(btn.dataset.lat);
  const lo = parseFloat(btn.dataset.lon);
  const name = btn.querySelector("strong").textContent;
  loadWeather(la, lo, name);
  if (map) map.flyTo({ center: [lo, la], zoom: glZoom(9), duration: 1100 });
});

function readLocalSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch (_) {
    return {};
  }
}

function normalizeSettings(data) {
  const out = { ...DEFAULT_SETTINGS };
  if (data && typeof data === "object") {
    if (COUNTRIES[data.country] || /^[a-z]{2}$/.test(data.country || ""))
      out.country = data.country;
    if (data.tempUnit === "fahrenheit") out.tempUnit = "fahrenheit";
    if (data.windUnit === "mph") out.windUnit = "mph";
    if (["radar", "satellite", "clouds", "none"].includes(data.layer)) out.layer = data.layer;
    if (data.fronts === false) out.fronts = false;
    if (data.globe === false) out.globe = false;
    if (data.isobars === true) out.isobars = true;
    if (data.lang === "auto" || ["es","en","fr","pt","de","ar"].includes(data.lang))
      out.lang = data.lang;
  }
  return out;
}

function persistLocalSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) {}
}

async function loadRemoteSettings(user) {
  if (!user || user.isAnonymous) return null;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && snap.data().settings) return snap.data().settings;
  } catch (_) {}
  return null;
}

async function saveRemoteSettings(user) {
  if (!user || user.isAnonymous) return;
  try {
    await setDoc(
      doc(db, "users", user.uid),
      { settings, updatedAt: Date.now() },
      { merge: true }
    );
  } catch (_) {}
}

/* ═══════════════════════════  2. UTILIDADES  ════════════════════════════ */

function toast(message, kind = "ok") {
  const holder = $("toasts");
  if (!holder) return;
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  const icon = kind === "error" ? "alert-circle" : "checkmark-circle";
  el.innerHTML = `<ion-icon name="${icon}"></ion-icon><span></span>`;
  el.querySelector("span").textContent = message;
  holder.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 320);
  }, 3400);
}

/* Iconos y descripciones para los códigos de tiempo WMO de Open-Meteo */
function weatherInfo(code, isDay = 1) {
  const day = isDay !== 0;
  const table = {
    0: { icon: day ? "sunny-outline" : "moon-outline", text: "Despejado" },
    1: { icon: day ? "sunny-outline" : "moon-outline", text: "Mayormente despejado" },
    2: { icon: day ? "partly-sunny-outline" : "cloudy-night-outline", text: "Parcialmente nublado" },
    3: { icon: "cloud-outline", text: "Nublado" },
    45: { icon: "reorder-two-outline", text: "Niebla" },
    48: { icon: "reorder-two-outline", text: "Niebla con escarcha" },
    51: { icon: "rainy-outline", text: "Llovizna ligera" },
    53: { icon: "rainy-outline", text: "Llovizna" },
    55: { icon: "rainy-outline", text: "Llovizna intensa" },
    56: { icon: "rainy-outline", text: "Llovizna helada" },
    57: { icon: "rainy-outline", text: "Llovizna helada intensa" },
    61: { icon: "rainy-outline", text: "Lluvia ligera" },
    63: { icon: "rainy-outline", text: "Lluvia" },
    65: { icon: "rainy-outline", text: "Lluvia fuerte" },
    66: { icon: "rainy-outline", text: "Lluvia helada" },
    67: { icon: "rainy-outline", text: "Lluvia helada fuerte" },
    71: { icon: "snow-outline", text: "Nieve ligera" },
    73: { icon: "snow-outline", text: "Nieve" },
    75: { icon: "snow-outline", text: "Nieve fuerte" },
    77: { icon: "snow-outline", text: "Granos de nieve" },
    80: { icon: "rainy-outline", text: "Chubascos ligeros" },
    81: { icon: "rainy-outline", text: "Chubascos" },
    82: { icon: "rainy-outline", text: "Chubascos violentos" },
    85: { icon: "snow-outline", text: "Chubascos de nieve" },
    86: { icon: "snow-outline", text: "Chubascos de nieve fuertes" },
    95: { icon: "thunderstorm-outline", text: "Tormenta eléctrica" },
    96: { icon: "thunderstorm-outline", text: "Tormenta con granizo" },
    99: { icon: "thunderstorm-outline", text: "Tormenta con granizo fuerte" },
  };
  return table[code] || { icon: "cloud-outline", text: "—" };
}

function tempSymbol() {
  return settings.tempUnit === "fahrenheit" ? "°F" : "°C";
}
function windSymbol() {
  return settings.windUnit === "mph" ? "mph" : "km/h";
}

function fmtHour(isoLocal) {
  const h = Number(isoLocal.slice(11, 13));
  const suffix = h >= 12 ? "p. m." : "a. m.";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

function fmtDayName(isoDate, index) {
  if (index === 0) return "Hoy";
  /* fecha-calendario del LUGAR: se interpreta a mediodía UTC y se formatea
     en UTC — cero dependencia de la zona/DST del navegador */
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString(tLocale(), { weekday: "short", day: "numeric", timeZone: "UTC" });
}

function fmtClock(date) {
  return date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

/* ═══════════════════════════  3. PRONÓSTICO  ════════════════════════════ */

let currentSpot = null; /* {lat, lon, label} */
let weatherAbort = null;
/* handle de introspección (como __fdcMap/__fdcEuro): permite a las pruebas
   de aceptación cargar un punto exacto sin simular gestos */
window.__fdcLoadWeather = (lat, lon, label) => loadWeather(lat, lon, label);

async function loadWeather(lat, lon, label) {
  currentSpot = { lat, lon, label };
  if (weatherAbort) weatherAbort.abort();
  weatherAbort = new AbortController();

  $("now-place").textContent = label;
  $("now-updated").textContent = t("updating");

  const aifsSel = euro.model === "aifs";
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,pressure_msl,is_day",
    /* Campos ampliados del IFS (verificados con respuestas reales en los
       5 puntos de aceptación: SD, Reikiavik, Singapur, Perth, McMurdo).
       freezing_level_height/visibility/uv_index NO los publica el IFS vía
       Open-Meteo (llegan nulos): se piden igual y la UI los muestra como
       "—" (sin datos) — regla cardinal, nada se inventa. */
    hourly:
      "temperature_2m,precipitation_probability,weather_code,is_day,wind_speed_10m,wind_gusts_10m,precipitation,cape,dew_point_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,snowfall,snow_depth,freezing_level_height,visibility,uv_index" +
      (aifsSel
        ? ""
        : ",temperature_850hPa,geopotential_height_500hPa,wind_speed_850hPa,wind_direction_850hPa,wind_speed_200hPa,wind_direction_200hPa"),
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_gusts_10m_max,sunrise,sunset,daylight_duration",
    /* IFS: 15 días completos verificados; AIFS publica 10 */
    forecast_days: aifsSel ? "10" : "15",
    timezone: "auto",
    temperature_unit: settings.tempUnit,
    wind_speed_unit: settings.windUnit === "mph" ? "mph" : "kmh",
    /* SOLO ECMWF: sin esto Open-Meteo mezcla modelos ("best match") y el
       panel dejaría de ser atribuible al centro. Verificado con
       respuestas reales. */
    models: aifsSel ? "ecmwf_aifs025_single" : "ecmwf_ifs025",
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: weatherAbort.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    /* copia sellada del Service Worker (sin red): se ANUNCIA la edad */
    staleStamp = res.headers.get("X-Fdc-Stale")
      ? Number(res.headers.get("X-Fdc-Cached-At")) || Date.now()
      : null;
    const data = await res.json();
    renderNow(data);
    renderHours(data);
    renderDays(data);
    refreshRisks(data, lat, lon, weatherAbort.signal);
    /* procedencia visible (modelo · pasada · edad) + probabilidades EPS */
    provRender(
      aifsSel ? "ecmwf_aifs025_single" : "ecmwf_ifs025",
      aifsSel ? "ECMWF AIFS (IA)" : "ECMWF IFS"
    );
    loadEps(lat, lon);
    renderClimo(data, lat, lon);
    loadMarine(lat, lon);
    updateLink();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    $("now-updated").textContent = t("load_fail");
    toast("Sin conexión con el servicio del tiempo.", "error");
  }
}

/* REGLA CARDINAL (anti-fabricación): lo que la API no devuelve se muestra
   como "—" (sin datos) — nunca un 0 que parezca una medición real */
function numOr(v, fmt) {
  return v == null || !Number.isFinite(Number(v)) ? "—" : fmt(Number(v));
}

function renderNow(data) {
  const c = data.current || {};
  const info = weatherInfo(c.weather_code, c.is_day);

  $("now-temp").textContent = numOr(c.temperature_2m, (v) => `${Math.round(v)}${tempSymbol()}`);
  $("now-desc").textContent = info.text;
  $("now-icon").innerHTML = `<ion-icon name="${info.icon}"></ion-icon>`;
  if (staleStamp) {
    const min = Math.max(1, Math.round((Date.now() - staleStamp) / 60000));
    $("now-updated").textContent = `${t("offline_data")} ${min} min`;
    $("now-updated").classList.add("is-stale");
  } else {
    $("now-updated").textContent = `${t("updated_at")} ${fmtClock(new Date())}`;
    $("now-updated").classList.remove("is-stale");
  }

  /* espejo en la cabecera de la hoja móvil */
  const st = $("sheet-temp");
  if (st) {
    st.textContent = numOr(c.temperature_2m, (v) => `${Math.round(v)}${tempSymbol()}`);
    $("sheet-desc").textContent = info.text;
    $("sheet-place").textContent = $("now-place").textContent;
  }

  /* campos que solo llegan en la serie horaria: se toma la hora actual */
  const h = data.hourly || {};
  const i0 = hourlyStart(data);
  const hv = (key) => (h[key] ? h[key][i0] : null);
  const cloudTri = [hv("cloud_cover_low"), hv("cloud_cover_mid"), hv("cloud_cover_high")];

  const stats = [
    { icon: "thermometer-outline", label: t("st_feels"), value: numOr(c.apparent_temperature, (v) => `${Math.round(v)}${tempSymbol()}`) },
    { icon: "water-outline", label: t("st_humidity"), value: numOr(c.relative_humidity_2m, (v) => `${Math.round(v)}%`) },
    { icon: "flag-outline", label: t("st_wind"), value: numOr(c.wind_speed_10m, (v) => `${Math.round(v)} ${windSymbol()}`) },
    { icon: "flash-outline", label: t("st_gusts"), value: numOr(c.wind_gusts_10m, (v) => `${Math.round(v)} ${windSymbol()}`) },
    { icon: "speedometer-outline", label: t("st_pressure"), value: numOr(c.pressure_msl, (v) => `${Math.round(v)} hPa`) },
    { icon: "rainy-outline", label: t("st_rain"), value: numOr(c.precipitation, (v) => `${v.toFixed(1)} mm`) },
    { icon: "thermometer-outline", label: t("st_dew"), value: numOr(hv("dew_point_2m"), (v) => `${Math.round(v)}${tempSymbol()}`) },
    {
      icon: "cloud-outline",
      label: t("st_clouds"),
      value: cloudTri.every((v) => v == null)
        ? "—"
        : cloudTri.map((v) => (v == null ? "—" : Math.round(v))).join("·") + " %",
    },
    { icon: "flash-outline", label: t("st_cape"), value: numOr(hv("cape"), (v) => `${Math.round(v)} J/kg`) },
    /* el IFS abierto NO publica estos tres: "—" honesto, jamás un invento */
    { icon: "snow-outline", label: t("st_freezing"), value: numOr(hv("freezing_level_height"), (v) => `${Math.round(v)} m`) },
    { icon: "eye-outline", label: t("st_visibility"), value: numOr(hv("visibility"), (v) => `${(v / 1000).toFixed(1)} km`) },
    { icon: "sunny-outline", label: t("st_uv"), value: numOr(hv("uv_index"), (v) => `${Math.round(v)}`) },
    /* altitud REAL que usó el modelo para este punto (DEM de Open-Meteo:
       Pico Duarte 3006 m vs costa 29 m, verificado en vivo) */
    { icon: "triangle-outline", label: t("st_elev"), value: numOr(data.elevation, (v) => `${Math.round(v)} m`) },
    { icon: "sunny-outline", label: t("st_sun"), value: sunLabel(data) },
  ];

  /* nieve: solo cuando hay señal (en el trópico sería ruido permanente) */
  const snowNow = hv("snowfall");
  const snowDepth = hv("snow_depth");
  if ((snowNow != null && snowNow > 0) || (snowDepth != null && snowDepth > 0)) {
    stats.push({ icon: "snow-outline", label: t("st_snow"), value: `${numOr(snowNow, (v) => v.toFixed(1) + " cm")} · ${numOr(snowDepth, (v) => (v * 100).toFixed(0) + " cm")}` });
  }

  /* altura (solo IFS: el AIFS abierto no publica niveles de presión) */
  const t850 = hv("temperature_850hPa");
  const z500 = hv("geopotential_height_500hPa");
  const shear = shearDeep(hv("wind_speed_850hPa"), hv("wind_direction_850hPa"), hv("wind_speed_200hPa"), hv("wind_direction_200hPa"));
  if (t850 != null || z500 != null) {
    stats.push(
      { icon: "trending-up-outline", label: t("st_t850"), value: numOr(t850, (v) => `${Math.round(v)}${tempSymbol()}`) },
      { icon: "layers-outline", label: t("st_z500"), value: numOr(z500, (v) => `${Math.round(v)} m`) },
      { icon: "swap-horizontal-outline", label: t("st_shear"), value: numOr(shear, (v) => `${Math.round(v)} ${windSymbol()}`) }
    );
  }

  $("now-grid").innerHTML = stats
    .map(
      (s) => `
      <div class="now__stat" title="${provTitleText}">
        <ion-icon name="${s.icon}"></ion-icon>
        <div><strong>${s.value}</strong><span>${s.label}</span></div>
      </div>`
    )
    .join("");
}

function renderHours(data) {
  const h = data.hourly || {};
  const times = h.time || [];
  if (!times.length) return;

  /* empieza en la hora actual del lugar */
  const nowIso = (data.current && data.current.time) || times[0];
  let start = times.findIndex((t) => t >= nowIso.slice(0, 13) + ":00");
  if (start < 0) start = 0;

  const cards = [];
  for (let i = start; i < Math.min(start + 24, times.length); i++) {
    const info = weatherInfo(h.weather_code?.[i], h.is_day?.[i]);
    const rain = h.precipitation_probability?.[i];
    cards.push(`
      <div class="hour${i === start ? " hour--now" : ""}" title="${provTitleText} · válido ${fmtHour(times[i])} local">
        <span class="hour__time">${i === start ? "Ahora" : fmtHour(times[i])}</span>
        <ion-icon name="${info.icon}"></ion-icon>
        <span class="hour__temp">${numOr(h.temperature_2m?.[i], (v) => `${Math.round(v)}°`)}</span>
        <span class="hour__rain"><ion-icon name="water-outline"></ion-icon>${rain == null ? "—" : `${rain}%`}</span>
      </div>`);
  }
  $("hours").innerHTML = cards.join("");
}

function renderDays(data) {
  const d = data.daily || {};
  const days = d.time || [];
  $("days").innerHTML = days
    .map((date, i) => {
      const info = weatherInfo(d.weather_code?.[i], 1);
      return `
      <div class="day" title="${provTitleText} · válido ${date}">
        <span class="day__name">${fmtDayName(date, i)}</span>
        <ion-icon name="${info.icon}" title="${info.text}"></ion-icon>
        <span class="day__rain"><ion-icon name="water-outline"></ion-icon>${d.precipitation_probability_max?.[i] == null ? "—" : `${d.precipitation_probability_max[i]}%`}</span>
        <span class="day__temps">
          <span class="day__max">${numOr(d.temperature_2m_max?.[i], (v) => `${Math.round(v)}°`)}</span>
          <span class="day__min">${numOr(d.temperature_2m_min?.[i], (v) => `${Math.round(v)}°`)}</span>
        </span>
      </div>`;
    })
    .join("");
}

/* ═══════════  3a-bis. PROCEDENCIA, CIZALLA Y PASADA DEL MODELO  ══════════ */

/* cizalla vectorial entre dos niveles (dir = de dónde viene el viento);
   unidades: las mismas del pedido (windSymbol) */
function shearDeep(spdLo, dirLo, spdHi, dirHi) {
  if (spdLo == null || dirLo == null || spdHi == null || dirHi == null) return null;
  const toUV = (s, d) => {
    const r = (d * Math.PI) / 180;
    return [-s * Math.sin(r), -s * Math.cos(r)];
  };
  const [u1, v1] = toUV(spdLo, dirLo);
  const [u2, v2] = toUV(spdHi, dirHi);
  return Math.hypot(u2 - u1, v2 - v1);
}

/* Pasada del modelo (procedencia real): Open-Meteo publica la hora de
   inicialización de la última corrida en /data/<modelo>/static/meta.json
   (verificado con respuesta real: last_run_initialisation_time). */
const runMeta = new Map(); /* modelId → {at, data|null} */

async function loadRunMeta(modelId) {
  const hit = runMeta.get(modelId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  let data = null;
  try {
    const res = await fetch(`https://api.open-meteo.com/data/${modelId}/static/meta.json`);
    if (res.ok) {
      const m = await res.json();
      if (m && m.last_run_initialisation_time) data = m;
    }
  } catch (_) {}
  runMeta.set(modelId, { at: Date.now(), data });
  return data;
}

async function provRender(modelId, label) {
  const line = $("prov-line");
  if (!line) return;
  const meta = await loadRunMeta(modelId);
  line.hidden = false;
  if (!meta) {
    /* sin metadatos no se inventa una pasada: se dice que no hay */
    provTitleText = `${label} · pasada: sin datos`;
    $("prov-text").textContent = provTitleText;
    $("prov-badge").hidden = true;
    return;
  }
  const init = meta.last_run_initialisation_time * 1000;
  const d = new Date(init);
  const ageH = (Date.now() - init) / 3600000;
  const runTxt = `${String(d.getUTCHours()).padStart(2, "0")}z (${d.getUTCDate()} ${d.toLocaleDateString(tLocale(), { month: "short", timeZone: "UTC" })})`;
  const ageTxt = ageH < 1 ? Math.round(ageH * 60) + " min" : Math.round(ageH) + " h";
  provTitleText = `${label} · pasada ${runTxt} · hace ${ageTxt}`;
  $("prov-text").textContent = provTitleText;
  /* insignia de pasada vieja (>7 h). Ojo: la propia latencia de
     publicación de ECMWF ronda 7 h — ver el informe de fase */
  $("prov-badge").hidden = ageH <= 7;
}

/* ═══════  3a-tris. PROBABILIDADES REALES DEL EPS (51 MIEMBROS)  ══════════
   Cada porcentaje de esta sección sale de CONTAR miembros del ensemble de
   ECMWF que superan un umbral, y el conteo (N/51) se muestra al lado para
   que cualquiera pueda verificarlo. Nada de probabilidades de caja negra. */

const eps = { key: null, abort: null, data: null, fanVar: "temp", sys: "eps" };
try {
  const s = localStorage.getItem("fdc-eps-sys");
  if (s) eps.sys = s;
} catch (_) {}

/* ═══ SISTEMAS DE ENSAMBLES (decisión del dueño 2026-09-04: se reabren
   los ensambles multi-modelo — antes la consola era solo ECMWF).
   Miembros y variables VERIFICADOS en vivo, sonda 33896739097:
   ecmwf_ifs025 51m · gfs025 31m · gem_global 21m (sin ráfagas) ·
   icon_seamless 40m (sin ráfagas) · ecmwf_aifs025 51m (sin ráfagas).
   BOM (todo nulo) y UKMO (timeout TLS) quedaron fuera con evidencia. */
const ENS_SYSTEMS = {
  eps: { om: "ecmwf_ifs025", label: "EPS de ECMWF", short: "EPS", gusts: true, ai: false },
  gefs: { om: "gfs025", label: "GEFS de NOAA", short: "GEFS", gusts: true, ai: false },
  geps: { om: "gem_global", label: "GEPS de ECCC (Canadá)", short: "GEPS", gusts: false, ai: false },
  icon: { om: "icon_seamless", label: "ICON-EPS de DWD", short: "ICON", gusts: false, ai: false },
  aifs: { om: "ecmwf_aifs025", label: "AIFS-ENS de ECMWF (IA)", short: "AIFS", gusts: false, ai: true },
};
/* pools con pesos IGUALES por miembro (se documenta en la nota) */
const ENS_POOLS = {
  super: { keys: ["eps", "gefs", "geps", "icon"], label: "Súper-ensamble (físicos)" },
  grand: { keys: ["eps", "gefs", "geps", "icon", "aifs"], label: "Grand ensamble (físicos + IA)" },
};

/* caché por punto+modelo: el súper y el grand reutilizan lo ya bajado */
const ensCache = new Map(); /* "lat|lon|om" → {at, hourly} */

/* variables disponibles en el abanico de percentiles */
const EPS_FAN_VARS = {
  temp: { base: "temperature_2m", unit: "°" },
  rain: { base: "precipitation", unit: " mm/h" },
  wind: { base: "wind_speed_10m", unit: " km/h" },
  gusts: { base: "wind_gusts_10m", unit: " km/h" },
};

function epsSeries(base) {
  const h = (eps.data && eps.data.hourly) || {};
  const out = [];
  for (const k of Object.keys(h)) {
    if (k === base || k.startsWith(base + "_member")) {
      const arr = h[k];
      if (Array.isArray(arr) && arr.some((v) => v != null)) out.push(arr);
    }
  }
  return out;
}

function qSorted(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* percentiles por hora a través de los miembros: banda p10–p90, banda
   p30–p70, mediana (p50) y MEDIA — lo que pidió el dueño, tal cual */
function epsFanData(members) {
  const n = members[0] ? members[0].length : 0;
  const fan = { p10: [], p30: [], p50: [], p70: [], p90: [], mean: [], sd: [] };
  for (let t = 0; t < n; t++) {
    const vals = [];
    for (const m of members) if (m[t] != null) vals.push(m[t]);
    vals.sort((a, b) => a - b);
    fan.p10.push(qSorted(vals, 0.1));
    fan.p30.push(qSorted(vals, 0.3));
    fan.p50.push(qSorted(vals, 0.5));
    fan.p70.push(qSorted(vals, 0.7));
    fan.p90.push(qSorted(vals, 0.9));
    if (vals.length) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      fan.mean.push(mean);
      fan.sd.push(
        vals.length > 1
          ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length - 1))
          : null
      );
    } else {
      fan.mean.push(null);
      fan.sd.push(null);
    }
  }
  return fan;
}

/* acumulado por día-calendario DEL LUGAR (las horas llegan en su tz) */
function epsDailySums(times, member) {
  const out = new Map();
  for (let i = 0; i < times.length; i++) {
    if (member[i] == null) continue;
    const day = times[i].slice(0, 10);
    out.set(day, (out.get(day) || 0) + member[i]);
  }
  return out;
}

function epsDailyExtreme(times, member, fn) {
  const out = new Map();
  for (let i = 0; i < times.length; i++) {
    if (member[i] == null) continue;
    const day = times[i].slice(0, 10);
    out.set(day, out.has(day) ? fn(out.get(day), member[i]) : member[i]);
  }
  return out;
}

/* ¿Está VIVO el ensemble en la fuente? Sondeo real (2026-07-22): el
   AIFS-ENS de Open-Meteo quedó congelado en la pasada del 24-feb-2025
   (last_run_initialisation_time) aunque el endpoint siga devolviendo
   series. Servir eso como probabilidad de hoy sería fabricar datos:
   para el AIFS se exige METADATO FRESCO; para el IFS basta con que no
   haya prueba positiva de estancamiento. */
async function ensFresh(modelId, requireProof) {
  const meta = await loadRunMeta(modelId);
  if (!meta) return !requireProof;
  return Date.now() / 1000 - meta.last_run_initialisation_time < 48 * 3600;
}

/* baja UN modelo de ensamble para un punto (caché 30 min). Si la API
   rechaza la lista de variables (400), se reintenta sin nieve/ráfagas:
   algunos sistemas no las publican y no por eso se pierde el resto. */
async function ensFetchModel(lat, lon, om, signal) {
  const ck = `${lat.toFixed(2)}|${lon.toFixed(2)}|${om}`;
  const hit = ensCache.get(ck);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.hourly;
  const q = (vars) =>
    new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: vars,
      forecast_days: "7",
      timezone: "auto",
      models: om,
      temperature_unit: "celsius" /* umbrales en °C; se convierte al pintar */,
      wind_speed_unit: "kmh",
    });
  let res = await fetch(
    `https://ensemble-api.open-meteo.com/v1/ensemble?${q("temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,snowfall")}`,
    { signal }
  );
  if (res.status === 400)
    res = await fetch(
      `https://ensemble-api.open-meteo.com/v1/ensemble?${q("temperature_2m,precipitation,wind_speed_10m")}`,
      { signal }
    );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  const d = Array.isArray(raw) ? raw[0] : raw;
  const hourly = (d && d.hourly) || {};
  ensCache.set(ck, { at: Date.now(), hourly });
  if (ensCache.size > 30) ensCache.delete(ensCache.keys().next().value);
  return hourly;
}

/* junta varios sistemas en un solo "hourly": cada miembro se renombra
   `<base>_memberNN__<sistema>` (así todo el render existente los ve) y
   los tiempos se alinean por marca ISO contra el eje del primer sistema */
function ensPoolHourly(parts) {
  const axis = parts[0].hourly.time || [];
  const out = { time: axis };
  const counts = {};
  for (const { sys, hourly } of parts) {
    const t = hourly.time || [];
    let map = null; /* null → mismas posiciones, sin copia */
    if (t.length !== axis.length || t[0] !== axis[0] || t[t.length - 1] !== axis[axis.length - 1]) {
      const idx = new Map(t.map((s, i) => [s, i]));
      map = axis.map((s) => (idx.has(s) ? idx.get(s) : -1));
    }
    const cnt = {};
    for (const k of Object.keys(hourly)) {
      if (k === "time") continue;
      const arr = hourly[k];
      if (!Array.isArray(arr) || !arr.some((v) => v != null)) continue;
      const base = k.replace(/_member\d+$/, "");
      cnt[base] = (cnt[base] || 0) + 1;
      out[`${base}_member${String(cnt[base]).padStart(2, "0")}__${sys}`] = map
        ? axis.map((_, i) => (map[i] >= 0 ? arr[map[i]] : null))
        : arr;
    }
    counts[sys] = cnt.temperature_2m || 0;
  }
  return { hourly: out, counts };
}

async function loadEps(lat, lon) {
  const block = $("eps-block");
  if (!block) return;
  block.hidden = false;
  const pool = ENS_POOLS[eps.sys];
  const sysKeys = pool ? pool.keys : [ENS_SYSTEMS[eps.sys] ? eps.sys : "eps"];
  const label = pool ? pool.label : ENS_SYSTEMS[sysKeys[0]].label;
  $("eps-title").textContent = label;
  const key = `${lat.toFixed(2)}|${lon.toFixed(2)}|${eps.sys}`;
  if (eps.key === key && eps.data && Date.now() - eps.data.at < 30 * 60 * 1000) {
    epsRender();
    return;
  }
  $("eps-head").textContent = "Calculando con los escenarios del ensemble…";
  $("eps-thresholds").innerHTML = "";
  $("eps-legend").hidden = true;
  if (eps.abort) eps.abort.abort();
  eps.abort = new AbortController();
  eps.key = key;
  const signal = eps.abort.signal;
  try {
    const parts = [];
    const dropped = [];
    for (const sk of sysKeys) {
      const cfg = ENS_SYSTEMS[sk];
      /* IA: metadato de pasada FRESCO obligatorio (la fuente estuvo
         congelada meses en 2025); físicos: solo bloquea la prueba
         positiva de estancamiento. Nada de probabilidades zombis. */
      if (!(await ensFresh(cfg.om, cfg.ai))) {
        dropped.push(`${cfg.short} (pasada vieja en la fuente)`);
        continue;
      }
      try {
        parts.push({ sys: sk, hourly: await ensFetchModel(lat, lon, cfg.om, signal) });
      } catch (e) {
        if (e && e.name === "AbortError") throw e;
        dropped.push(`${cfg.short} (sin respuesta)`);
      }
    }
    if (eps.key !== key) return; /* el usuario ya cambió de sistema/punto */
    if (!parts.length) {
      eps.data = null;
      $("eps-head").textContent =
        sysKeys.length === 1 && ENS_SYSTEMS[sysKeys[0]].ai
          ? "El AIFS-ENS no se está actualizando en la fuente abierta — sin probabilidades (vuelve cuando su pasada sea fresca)."
          : dropped.length
            ? `Sin datos: ${dropped.join(" · ")}.`
            : "Sin datos del ensemble ahora mismo.";
      $("eps-note").hidden = true;
      $("conf-badge").hidden = true;
      return;
    }
    let hourly = parts[0].hourly;
    let counts = null;
    if (pool || parts.length > 1) ({ hourly, counts } = ensPoolHourly(parts));
    eps.data = { at: Date.now(), hourly, ensName: label, counts, dropped };
    epsRender();
  } catch (err) {
    if (err && err.name === "AbortError") return;
    eps.data = null;
    $("eps-head").textContent = "Sin datos del ensemble ahora mismo.";
    $("conf-badge").hidden = true;
  }
}

/* umbrales del encargo: lluvia diaria, ráfagas en kt→km/h, helada/calor */
const EPS_RAIN_THR = [0.2, 1, 5, 10, 25, 50, 100]; /* mm/día */
const EPS_GUST_THR = [
  { kt: 34, kmh: 63 },
  { kt: 50, kmh: 93 },
  { kt: 64, kmh: 119 },
  { kt: 96, kmh: 178 },
];

function epsChip(pct, count, total, label) {
  return `<div class="eps-chip" title="${count} de ${total} escenarios">
    <strong>${pct}%</strong><span>${label}</span><small>${count}/${total}</small>
  </div>`;
}

/* viento sostenido: mismos umbrales en kt que el producto prob24 del mapa */
const EPS_WIND_THR = [
  { kt: 20, kmh: 37.0 },
  { kt: 35, kmh: 64.8 },
  { kt: 50, kmh: 92.6 },
];

function epsRender() {
  if (!eps.data) return;
  const h = eps.data.hourly;
  const times = h.time || [];
  const temps = epsSeries("temperature_2m");
  const rains = epsSeries("precipitation");
  const winds = epsSeries("wind_speed_10m");
  const gusts = epsSeries("wind_gusts_10m");
  const snows = epsSeries("snowfall");
  const N = temps.length;
  if (!N || !times.length) {
    $("eps-head").textContent = "Sin datos del ensemble ahora mismo.";
    return;
  }

  /* abanico: solo variables con miembros reales en el sistema activo */
  const avail = { temp: temps.length, rain: rains.length, wind: winds.length, gusts: gusts.length };
  document.querySelectorAll("#eps-fanvar [data-value]").forEach((b) => {
    b.style.display = avail[b.dataset.value] ? "" : "none";
  });

  const fan = epsFanData(temps);
  /* confianza: dispersión media (σ) de la temperatura en las próximas 72 h */
  const sd72 = fan.sd.slice(0, 72).filter((v) => v != null);
  const sdMean = sd72.length ? sd72.reduce((a, b) => a + b, 0) / sd72.length : null;
  const conf = sdMean == null ? null : sdMean < 1.0 ? "alta" : sdMean < 2.2 ? "media" : "baja";
  const desglose = eps.data.counts
    ? ` (${Object.entries(eps.data.counts)
        .map(([k, c]) => `${ENS_SYSTEMS[k].short} ${c}`)
        .join(" + ")})`
    : "";
  $("eps-head").textContent =
    `${N} escenarios${desglose} · dispersión media ±${sdMean == null ? "—" : sdMean.toFixed(1)} °C (72 h)` +
    (conf ? ` · confianza ${conf.toUpperCase()}` : "");
  const cb = $("conf-badge");
  if (cb) {
    cb.hidden = conf == null;
    cb.textContent = `confianza ${conf || "—"}`;
    cb.dataset.level = conf || "";
  }

  epsDrawCurrentFan();
  $("eps-legend").hidden = false;

  /* ── tablas de umbral con conteos reproducibles. El denominador es el
     nº de miembros CON DATOS ese día: en los pools no todos los sistemas
     cubren el mismo horizonte, y contar ausentes como "no supera" sería
     inventarse probabilidad ── */
  const days = [...new Set(times.map((t) => t.slice(0, 10)))].slice(0, 3);
  const rows = [];

  /* lluvia por día */
  const rainSums = rains.map((m) => epsDailySums(times, m));
  for (const day of days) {
    const withDay = rainSums.filter((s) => s.has(day));
    if (!withDay.length) continue;
    const chips = EPS_RAIN_THR.map((thr) => {
      const c = withDay.filter((s) => s.get(day) > thr).length;
      return epsChip(Math.round((100 * c) / withDay.length), c, withDay.length, `>${thr} mm`);
    }).join("");
    rows.push(`<div class="eps-row"><span class="eps-row__label">Lluvia · ${fmtDayName(day, days.indexOf(day))}</span><div class="eps-chips">${chips}</div></div>`);
  }

  /* viento sostenido: máx del día por miembro, umbrales en kt (como prob24) */
  if (winds.length) {
    const wMax = winds.map((m) => epsDailyExtreme(times, m, Math.max));
    for (const day of days) {
      const withDay = wMax.filter((s) => s.has(day));
      if (!withDay.length) continue;
      const chips = EPS_WIND_THR.map(({ kt, kmh }) => {
        const c = withDay.filter((s) => s.get(day) > kmh).length;
        return epsChip(Math.round((100 * c) / withDay.length), c, withDay.length, `≥${kt} kt`);
      }).join("");
      rows.push(`<div class="eps-row"><span class="eps-row__label">Viento · ${fmtDayName(day, days.indexOf(day))}</span><div class="eps-chips">${chips}</div></div>`);
    }
  }

  /* ráfagas máximas en 48 h (solo sistemas que las publican) */
  if (gusts.length) {
    const gustMax = gusts.map((m) => {
      let mx = null;
      for (let i = 0; i < Math.min(48, m.length); i++) if (m[i] != null && (mx == null || m[i] > mx)) mx = m[i];
      return mx;
    });
    const gN = gustMax.filter((v) => v != null).length;
    if (gN) {
      const gustChips = EPS_GUST_THR.map(({ kt, kmh }) => {
        const c = gustMax.filter((v) => v != null && v > kmh).length;
        return epsChip(Math.round((100 * c) / gN), c, gN, `>${kmh} km/h (${kt} kt)`);
      }).join("");
      rows.push(`<div class="eps-row"><span class="eps-row__label">Ráfagas · próximas 48 h</span><div class="eps-chips">${gustChips}</div></div>`);
    }
  }

  /* helada y calor por día (mín/máx del día por miembro, °C) */
  const tMin = temps.map((m) => epsDailyExtreme(times, m, Math.min));
  const tMax = temps.map((m) => epsDailyExtreme(times, m, Math.max));
  const frostChips = days
    .map((day, i) => {
      const withDay = tMin.filter((s) => s.has(day));
      if (!withDay.length) return "";
      const c = withDay.filter((s) => s.get(day) < 0).length;
      return epsChip(Math.round((100 * c) / withDay.length), c, withDay.length, fmtDayName(day, i));
    })
    .join("");
  rows.push(`<div class="eps-row"><span class="eps-row__label">Helada (mín &lt; 0 °C)</span><div class="eps-chips">${frostChips}</div></div>`);
  const heatChips = days
    .map((day, i) => {
      const withDay = tMax.filter((s) => s.has(day));
      if (!withDay.length) return "";
      const c = withDay.filter((s) => s.get(day) > 35).length;
      return epsChip(Math.round((100 * c) / withDay.length), c, withDay.length, fmtDayName(day, i));
    })
    .join("");
  rows.push(`<div class="eps-row"><span class="eps-row__label">Calor (máx &gt; 35 °C)</span><div class="eps-chips">${heatChips}</div></div>`);

  /* nieve: solo si algún miembro da algo (>0.1 cm/día) */
  const snowSums = snows.map((m) => epsDailySums(times, m));
  const anySnow = days.some((day) => snowSums.some((s) => (s.get(day) || 0) > 0.1));
  if (anySnow) {
    for (const day of days) {
      const withDay = snowSums.filter((s) => s.has(day));
      if (!withDay.length) continue;
      const chips = [1, 5, 20].map((thr) => {
        const c = withDay.filter((s) => s.get(day) > thr).length;
        return epsChip(Math.round((100 * c) / withDay.length), c, withDay.length, `>${thr} cm`);
      }).join("");
      rows.push(`<div class="eps-row"><span class="eps-row__label">Nieve · ${fmtDayName(day, days.indexOf(day))}</span><div class="eps-chips">${chips}</div></div>`);
    }
  }

  $("eps-thresholds").innerHTML = rows.join("");
  const note = $("eps-note");
  note.hidden = false;
  const fuente = eps.data.counts
    ? Object.entries(eps.data.counts)
        .map(([k, c]) => `${ENS_SYSTEMS[k].label} (${c})`)
        .join(" + ") + " · pesos iguales por miembro"
    : eps.data.ensName;
  note.textContent =
    `Cada porcentaje es el conteo directo de los miembros que superan el umbral (N/M con M = miembros con datos ese día). ` +
    `Fuente: ${fuente}. ` +
    (eps.data.dropped && eps.data.dropped.length ? `Excluidos hoy: ${eps.data.dropped.join(", ")}. ` : "") +
    "Abanico: bandas p10–p90 y p30–p70, mediana (p50) y media. Confianza: σ media de temperatura a 72 h — alta < 1.0 °C, media < 2.2 °C, baja ≥ 2.2 °C.";

  /* estructura expuesta para verificación externa (pruebas de aceptación) */
  window.__fdcEpsCalc = { members: N, sdMean, conf, days, counts: eps.data.counts, dropped: eps.data.dropped };
}

/* abanico de la variable elegida (temperatura / lluvia / ráfagas) */
function epsDrawCurrentFan() {
  if (!eps.data) return;
  let cfgF = EPS_FAN_VARS[eps.fanVar] || EPS_FAN_VARS.temp;
  let members = epsSeries(cfgF.base);
  if (!members.length && eps.fanVar !== "temp") {
    /* el sistema activo no publica esa variable: cae a temperatura */
    eps.fanVar = "temp";
    setSegValue("eps-fanvar", "temp");
    cfgF = EPS_FAN_VARS.temp;
    members = epsSeries(cfgF.base);
  }
  const times = (eps.data.hourly && eps.data.hourly.time) || [];
  if (!members.length || !times.length) return;
  const fan = epsFanData(members);
  /* expuesto para verificación externa: percentiles/media reproducibles */
  window.__fdcEpsFan = {
    var: eps.fanVar,
    members: members.length,
    p30: fan.p30,
    p50: fan.p50,
    p70: fan.p70,
    mean: fan.mean,
  };
  epsDrawFan(times, members, fan, cfgF.unit);
}

/* abanico de percentiles + espagueti de todos los miembros */
function epsDrawFan(times, members, fan, unit = "°") {
  const cv = $("eps-fan");
  if (!cv || !cv.getContext) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || cv.parentElement.clientWidth || 600;
  const H = 180;
  cv.width = W * dpr;
  cv.height = H * dpr;
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const n = fan.p50.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (fan.p10[i] != null) lo = Math.min(lo, fan.p10[i]);
    if (fan.p90[i] != null) hi = Math.max(hi, fan.p90[i]);
  }
  if (!isFinite(lo) || !isFinite(hi)) return;
  const pad = (hi - lo) * 0.12 + 0.5;
  lo -= pad;
  hi += pad;
  const X = (i) => (i / (n - 1)) * (W - 34) + 30;
  const Y = (v) => H - 18 - ((v - lo) / (hi - lo)) * (H - 30);

  /* medianoche del lugar: líneas de día */
  ctx.strokeStyle = "rgba(122,162,255,0.14)";
  ctx.fillStyle = "rgba(196,208,240,0.55)";
  ctx.font = "10px system-ui";
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    if (times[i].slice(11, 16) === "00:00") {
      ctx.beginPath();
      ctx.moveTo(X(i), 6);
      ctx.lineTo(X(i), H - 16);
      ctx.stroke();
      ctx.fillText(fmtDayName(times[i].slice(0, 10), 1), X(i) + 3, H - 6);
    }
  }

  const band = (loArr, hiArr, color) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(loArr[i]));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(hiArr[i]));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  /* espagueti: TODOS los miembros, finitos y tenues */
  ctx.strokeStyle = "rgba(150,180,255,0.06)";
  for (const m of members) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) if (m[i] != null) ctx.lineTo(X(i), Y(m[i]));
    ctx.stroke();
  }

  band(fan.p10, fan.p90, "rgba(122,162,255,0.16)");
  band(fan.p30, fan.p70, "rgba(122,162,255,0.26)");
  ctx.beginPath();
  for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(fan.p50[i]));
  ctx.strokeStyle = "rgba(255,224,138,0.95)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  /* media: punteada, distinguible de la mediana */
  ctx.beginPath();
  ctx.setLineDash([5, 4]);
  for (let i = 0; i < n; i++) if (fan.mean[i] != null) ctx.lineTo(X(i), Y(fan.mean[i]));
  ctx.strokeStyle = "rgba(126,231,196,0.9)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.setLineDash([]);

  /* eje: mín y máx (en la unidad de la variable) */
  ctx.fillStyle = "rgba(196,208,240,0.7)";
  ctx.fillText(`${Math.round(hi - pad)}${unit}`, 4, 14);
  ctx.fillText(`${Math.round(lo + pad)}${unit}`, 4, H - 20);
}

/* ═══════  3a-quater. ANOMALÍA VS CLIMATOLOGÍA (ERA5 1991–2020)  ══════════
   ¿Qué tan raro es este pronóstico para esta fecha en este lugar? Se baja
   UNA vez por punto la serie diaria ERA5 de 30 años (verificado: una sola
   petición) y el percentil se calcula aquí, contra los mismos ±10 días de
   calendario de esos 30 años (~630 muestras). */

const climoCache = new Map(); /* "lat|lon" → {byDay: Map("MM-DD"→{tmax[],psum[]})} */

async function loadClimo(lat, lon) {
  const key = `${(Math.round(lat * 2) / 2).toFixed(1)}|${(Math.round(lon * 2) / 2).toFixed(1)}`;
  if (climoCache.has(key)) return climoCache.get(key);
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    start_date: "1991-01-01",
    end_date: "2020-12-31",
    daily: "temperature_2m_max,precipitation_sum",
    timezone: "auto",
    models: "era5",
  });
  const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  const t = (d.daily && d.daily.time) || [];
  const tmax = d.daily.temperature_2m_max || [];
  const psum = d.daily.precipitation_sum || [];
  const byDay = new Map();
  for (let i = 0; i < t.length; i++) {
    const md = t[i].slice(5); /* "MM-DD" */
    let e = byDay.get(md);
    if (!e) {
      e = { tmax: [], psum: [] };
      byDay.set(md, e);
    }
    if (tmax[i] != null) e.tmax.push(tmax[i]);
    if (psum[i] != null) e.psum.push(psum[i]);
  }
  const entry = { byDay };
  climoCache.set(key, entry);
  return entry;
}

/* muestra climatológica: mismos ±window días de calendario, 30 años */
function climoSample(byDay, isoDate, field, windowDays = 10) {
  const base = new Date(`${isoDate}T12:00:00Z`);
  const out = [];
  for (let k = -windowDays; k <= windowDays; k++) {
    const d = new Date(base.getTime() + k * 86400000);
    const md = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const e = byDay.get(md);
    if (e) out.push(...e[field]);
  }
  return out.sort((a, b) => a - b);
}

function pctRank(sortedSample, v) {
  if (!sortedSample.length || v == null) return null;
  let below = 0;
  for (const x of sortedSample) if (x < v) below++;
  return Math.round((100 * below) / sortedSample.length);
}

function climoTag(p) {
  if (p == null) return "";
  if (p >= 98 || p <= 2) return " · excepcional";
  if (p >= 90 || p <= 10) return " · inusual";
  return "";
}

/* el pronóstico diario llega en la unidad del usuario; ERA5 se pide en °C:
   se normaliza a °C para comparar peras con peras */
function toC(v) {
  return settings.tempUnit === "fahrenheit" ? ((v - 32) * 5) / 9 : v;
}

let climoSeq = 0;
async function renderClimo(data, lat, lon) {
  const block = $("climo-block");
  if (!block) return;
  const seq = ++climoSeq;
  const daily = data.daily || {};
  const days = daily.time || [];
  if (!days.length) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  $("climo-chips").innerHTML = `<div class="eps-chip"><strong>…</strong><span>calculando</span></div>`;
  let cl;
  try {
    cl = await loadClimo(lat, lon);
  } catch (_) {
    if (seq !== climoSeq) return;
    $("climo-chips").innerHTML = "";
    $("climo-note").hidden = false;
    $("climo-note").textContent = "Sin climatología disponible ahora mismo (ERA5 no respondió).";
    return;
  }
  if (seq !== climoSeq) return; /* ya se pidió otro punto */

  const chips = [];
  const labels = ["hoy", "mañana"];
  for (let i = 0; i < 2 && i < days.length; i++) {
    const tS = climoSample(cl.byDay, days[i], "tmax");
    const pT = pctRank(tS, toC(daily.temperature_2m_max?.[i]));
    if (pT != null)
      chips.push(
        `<div class="eps-chip" title="frente a ${tS.length} días de 1991-2020 (±10 días de calendario)"><strong>p${pT}</strong><span>máx. ${labels[i]}${climoTag(pT)}</span><small>${tS.length} muestras</small></div>`
      );
    const pS = climoSample(cl.byDay, days[i], "psum");
    const pP = pctRank(pS, daily.precipitation_sum?.[i]);
    if (pP != null && (daily.precipitation_sum?.[i] ?? 0) > 0)
      chips.push(
        `<div class="eps-chip" title="frente a ${pS.length} días de 1991-2020"><strong>p${pP}</strong><span>lluvia ${labels[i]}${climoTag(pP)}</span><small>${pS.length} muestras</small></div>`
      );
  }
  $("climo-chips").innerHTML = chips.join("") || "";
  const note = $("climo-note");
  note.hidden = false;
  note.textContent = chips.length
    ? "Percentil del pronóstico ECMWF frente a los mismos ±10 días de calendario en ERA5 1991–2020 (reanálisis de ECMWF). ≥p90 inusual · ≥p98 excepcional para la fecha y el lugar."
    : "Sin valores comparables hoy (p. ej. lluvia pronosticada 0 mm).";
}

/* ═══════════  3a-quater-bis. MAR (olas del ECMWF WAM)  ═══════════════════
   La "detección costera" es la respuesta REAL de la fuente: un punto
   interior devuelve todas las horas nulas (Madrid 0/24, costa 24/24 —
   sondeado en vivo, corrida 30369449924). Si hay datos, el bloque
   aparece; si no, no existe. swell_wave_* llega nulo con este modelo y
   no se pide. */
const marineCache = new Map(); /* "lat|lon" → {at, data|null} */
let marineSeq = 0;

async function loadMarine(lat, lon) {
  const block = $("marine-block");
  if (!block) return;
  const seq = ++marineSeq;
  const key = `${lat.toFixed(2)}|${lon.toFixed(2)}`;
  const hit = marineCache.get(key);
  let d = hit && Date.now() - hit.at < 30 * 60 * 1000 ? hit.data : undefined;
  if (d === undefined) {
    try {
      const params = new URLSearchParams({
        latitude: lat.toFixed(4),
        longitude: lon.toFixed(4),
        hourly: "wave_height,wave_period,wave_direction",
        forecast_days: "3",
        timezone: "auto",
        models: "ecmwf_wam025",
      });
      const res = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params}`);
      d = res.ok ? await res.json() : null;
      if (d && !(d.hourly && (d.hourly.wave_height || []).some((v) => v != null)))
        d = null; /* interior: todo nulo */
    } catch (_) {
      d = null;
    }
    marineCache.set(key, { at: Date.now(), data: d });
    if (marineCache.size > 60) marineCache.delete(marineCache.keys().next().value);
  }
  if (seq !== marineSeq) return; /* ya se pidió otro punto */
  if (!d) {
    block.hidden = true;
    return;
  }
  const H = d.hourly;
  const i0 = (() => {
    const nowIso = new Date().toISOString().slice(0, 13);
    const i = H.time.findIndex((t) => t.slice(0, 13) >= nowIso);
    return i < 0 ? 0 : i;
  })();
  const deg2card = (v) =>
    ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round((v % 360) / 45) % 8];
  let hMax = null;
  for (let i = i0; i < Math.min(i0 + 48, H.time.length); i++) {
    const v = H.wave_height[i];
    if (v != null && (hMax == null || v > hMax)) hMax = v;
  }
  block.hidden = false;
  $("marine-grid").innerHTML = [
    { icon: "water-outline", label: t("ma_now"), value: numOr(H.wave_height[i0], (v) => `${v.toFixed(1)} m`) },
    { icon: "timer-outline", label: t("ma_period"), value: numOr(H.wave_period[i0], (v) => `${v.toFixed(1)} s`) },
    { icon: "compass-outline", label: t("ma_dir"), value: numOr(H.wave_direction[i0], (v) => `${deg2card(v)} (${Math.round(v)}°)`) },
    { icon: "trending-up-outline", label: t("ma_max48"), value: numOr(hMax, (v) => `${v.toFixed(1)} m`) },
  ]
    .map(
      (s) => `
      <div class="now__stat">
        <ion-icon name="${s.icon}"></ion-icon>
        <div><strong>${s.value}</strong><span>${s.label}</span></div>
      </div>`
    )
    .join("");
  const note = $("marine-note");
  note.hidden = false;
  note.textContent =
    "Olas del modelo WAM de ECMWF (0.25°, datos abiertos vía Open-Meteo). Aparece solo donde el modelo tiene mar.";
}

/* ═══════════  3a-quinquies. CICLONES TROPICALES (ENS de ECMWF)  ══════════
   Trayectorias por miembro detectadas por el rastreador del robot
   (mínimo cerrado + vorticidad + núcleo cálido; criterios publicados en
   ciclones.json). Espaguetis en el mapa + resumen por sistema en el
   panel. NUNCA se presenta como aviso oficial. */

const TC_BASINS = {
  atl: { name: "Atlántico", scale: "ss", rsmc: "NHC (EE. UU.)", url: "https://www.nhc.noaa.gov/" },
  epac: { name: "Pacífico este", scale: "ss", rsmc: "NHC (EE. UU.)", url: "https://www.nhc.noaa.gov/" },
  wpac: { name: "Pacífico oeste", scale: "jma", rsmc: "JMA (Japón)", url: "https://www.jma.go.jp/bosai/map.html" },
  nio: { name: "Índico norte", scale: "imd", rsmc: "IMD (India)", url: "https://rsmcnewdelhi.imd.gov.in/" },
  sio: { name: "Índico sur", scale: "mfr", rsmc: "Météo-France La Réunion", url: "https://meteofrance.re/fr" },
  aus: { name: "Región australiana", scale: "bom", rsmc: "BoM (Australia)", url: "http://www.bom.gov.au/cyclone/" },
  spac: { name: "Pacífico sur", scale: "bom", rsmc: "FMS (Fiyi)", url: "https://www.met.gov.fj/" },
  /* Atlántico sur: no existe RSMC de ciclones tropicales (son rarísimos);
     sin enlace verificable no se inventa ninguno */
  satl: { name: "Atlántico sur", scale: "ss", rsmc: null, url: null },
};

/* categoría EQUIVALENTE según la escala de la cuenca, a partir del viento
   máximo a 10 m del modelo (kt). Los avisos reales usan promedios de 1 ó
   10 min y análisis humanos: por eso siempre se rotula "equivalente". */
function tcScaleLabel(scaleId, kt) {
  if (scaleId === "ss") {
    if (kt >= 137) return "huracán cat. 5 (Saffir-Simpson)";
    if (kt >= 113) return "huracán cat. 4 (Saffir-Simpson)";
    if (kt >= 96) return "huracán cat. 3 (Saffir-Simpson)";
    if (kt >= 83) return "huracán cat. 2 (Saffir-Simpson)";
    if (kt >= 64) return "huracán cat. 1 (Saffir-Simpson)";
    if (kt >= 34) return "tormenta tropical";
    return "depresión tropical";
  }
  if (scaleId === "jma") {
    if (kt >= 64) return "tifón (escala JMA)";
    if (kt >= 48) return "tormenta tropical severa (JMA)";
    if (kt >= 34) return "tormenta tropical (JMA)";
    return "depresión tropical (JMA)";
  }
  if (scaleId === "imd") {
    if (kt >= 120) return "supertormenta ciclónica (IMD)";
    if (kt >= 90) return "torm. ciclónica extrem. severa (IMD)";
    if (kt >= 64) return "torm. ciclónica muy severa (IMD)";
    if (kt >= 48) return "tormenta ciclónica severa (IMD)";
    if (kt >= 34) return "tormenta ciclónica (IMD)";
    return "depresión (IMD)";
  }
  if (scaleId === "mfr") {
    if (kt >= 115) return "ciclón muy intenso (RSMC Reunión)";
    if (kt >= 90) return "ciclón intenso (RSMC Reunión)";
    if (kt >= 64) return "ciclón tropical (RSMC Reunión)";
    if (kt >= 48) return "torm. tropical fuerte (Reunión)";
    if (kt >= 34) return "torm. tropical moderada (Reunión)";
    return "depresión tropical";
  }
  /* escala australiana (BoM/FMS) */
  if (kt >= 108) return "ciclón cat. 5 (escala australiana)";
  if (kt >= 86) return "ciclón cat. 4 (escala australiana)";
  if (kt >= 64) return "ciclón cat. 3 (escala australiana)";
  if (kt >= 48) return "ciclón cat. 2 (escala australiana)";
  if (kt >= 34) return "ciclón cat. 1 (escala australiana)";
  return "baja tropical";
}

const tc = { data: null, strike: "off" };

async function loadCiclones() {
  try {
    const res = await fetch(`${STATIC_BASE}/ecmwf/ciclones.json`, { cache: "no-cache" });
    if (!res.ok) return (tc.data = null);
    const d = await res.json();
    /* el producto sale con cada pasada (cada ~6 h); con más de 12 h se
       considera caído y se retira — nunca trayectorias viejas como nuevas */
    if (!d || Date.now() / 1000 - (d.generated || 0) > 12 * 3600) return (tc.data = null);
    tc.data = d;
  } catch (_) {
    tc.data = null;
  }
}

/* asa de pruebas: recarga y repinta el producto de ciclones */
window.__fdcLoadCiclones = async () => {
  await loadCiclones();
  tcApply();
  tcRender();
};

function tcInitLayers() {
  if (!map.addSource) return;
  try {
    const empty = { type: "FeatureCollection", features: [] };
    map.addSource("tc-ens", { type: "geojson", data: empty });
    map.addSource("tc-det", { type: "geojson", data: empty });
    map.addLayer(
      {
        id: "tc-ens-lines",
        type: "line",
        source: "tc-ens",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 1, "line-color": "rgba(255,255,255,0.18)" },
      },
      labelsAnchor
    );
    map.addLayer(
      {
        id: "tc-det-line",
        type: "line",
        source: "tc-det",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 2.6, "line-color": "#ffd75e" },
      },
      labelsAnchor
    );
    map.addLayer(
      {
        id: "tc-det-point",
        type: "circle",
        source: "tc-det",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#ffd75e",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#1b2432",
        },
      },
      labelsAnchor
    );
  } catch (_) {}
}

/* pts: [h, lat, lon, presión, kt] → coordenadas [lon, lat] */
function tcLine(pts, props) {
  return {
    type: "Feature",
    properties: props || {},
    geometry: { type: "LineString", coordinates: pts.map((p) => [p[2], p[1]]) },
  };
}

function tcApply() {
  if (!map || !map.getSource) return;
  const sEns = map.getSource("tc-ens");
  const sDet = map.getSource("tc-det");
  if (!sEns || !sDet) return;
  const d = tc.data;
  const ensF = [];
  const detF = [];
  if (d) {
    for (const tr of d.ens || []) if (tr.pts?.length > 1) ensF.push(tcLine(tr.pts, { sys: tr.sys }));
    for (const tr of d.det || []) {
      if (!tr.pts?.length) continue;
      if (tr.pts.length > 1) detF.push(tcLine(tr.pts, { sys: tr.sys }));
      const last = tr.pts[tr.pts.length - 1];
      detF.push({
        type: "Feature",
        properties: { sys: tr.sys },
        geometry: { type: "Point", coordinates: [last[2], last[1]] },
      });
    }
  }
  sEns.setData({ type: "FeatureCollection", features: ensF });
  sDet.setData({ type: "FeatureCollection", features: detF });
  tcStrikeApply();
}

/* superposición de probabilidad de impacto (webp del robot) */
function tcStrikeApply() {
  const d = tc.data;
  const rel = d && tc.strike !== "off" ? d.strike?.[tc.strike] : null;
  const src = map.getSource && map.getSource("tc-strike-src");
  if (!rel) {
    try {
      if (map.getLayer && map.getLayer("tc-strike-layer")) map.removeLayer("tc-strike-layer");
      if (src) map.removeSource("tc-strike-src");
    } catch (_) {}
    return;
  }
  const b = d.strike.bbox;
  const coords = [
    [b.west, b.north],
    [b.east, b.north],
    [b.east, b.south],
    [b.west, b.south],
  ];
  const url = `${STATIC_BASE}/ecmwf/${rel}`;
  if (src && src.updateImage) {
    src.updateImage({ url, coordinates: coords });
  } else {
    try {
      map.addSource("tc-strike-src", { type: "image", url, coordinates: coords });
      map.addLayer(
        {
          id: "tc-strike-layer",
          type: "raster",
          source: "tc-strike-src",
          paint: { "raster-opacity": 0.6, "raster-fade-duration": 0 },
        },
        "tc-ens-lines"
      );
    } catch (_) {}
  }
}

function tcRender() {
  const block = $("tc-block");
  if (!block) return;
  const d = tc.data;
  if (!d) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  const run = d.run
    ? `pasada ${d.run.slice(8)}z (${d.run.slice(6, 8)}/${d.run.slice(4, 6)})`
    : "";
  $("tc-head").textContent = d.sistemas?.length
    ? `${d.sistemas.length} sistema${d.sistemas.length > 1 ? "s" : ""} · ${d.members} escenarios del ENS · ${run}`
    : `El ENS de ECMWF (${d.members} escenarios) no señala ciclones tropicales ahora · ${run}`;

  const items = [];
  for (const s of d.sistemas || []) {
    const b = TC_BASINS[s.basin] || TC_BASINS.atl;
    const esc = s.escenarios
      ? `<span class="tc-esc">rumbos: ${s.escenarios.map((e) => `${e.n} al ${e.rumbo}`).join(" · ")}</span>`
      : "";
    items.push(
      `<div class="tc-sys" data-lat="${s.genesis[0]}" data-lon="${s.genesis[1]}" role="button" tabindex="0">
        <div class="tc-sys__top"><strong>Sistema ${s.id} · ${b.name}</strong>
          <span>${s.members}/${d.members} escenarios (${s.pct} %)${s.det ? " · HRES lo ve" : ""}</span></div>
        <div class="tc-sys__mid">Máx. mediano ${s.max_kt_med} kt · equivalente
          ${tcScaleLabel(b.scale, s.max_kt_med)} <em>(viento bruto del modelo)</em></div>
        ${esc}
        ${b.url ? `<a href="${b.url}" target="_blank" rel="noopener">Avisos oficiales: ${b.rsmc} ↗</a>` : ""}
      </div>`
    );
  }
  $("tc-list").innerHTML = items.join("");
  for (const el of document.querySelectorAll("#tc-list .tc-sys")) {
    el.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) return;
      const la = parseFloat(el.dataset.lat);
      const lo = parseFloat(el.dataset.lon);
      if (map && isFinite(la)) map.flyTo({ center: [lo, la], zoom: 4.2 });
    });
  }
  const seg = $("tc-strike");
  const hasStrike = !!(d.strike && (d.strike.img34 || d.strike.img64));
  seg.hidden = !hasStrike || !(d.sistemas || []).length;
  const note = $("tc-note");
  note.hidden = false;
  const c = d.criteria || {};
  note.textContent =
    `Rastreador propio sobre las rejillas del ENS: mínimo de presión cerrado (≥${c.min_cerrado_hPa ?? 2} hPa), ` +
    `vorticidad ciclónica a 10 m y núcleo cálido en 850 hPa (≥${c.nucleo_calido_850_K ?? 0.5} K). ` +
    `Sistemas con ≥${c.min_miembros_sistema ?? 3} escenarios o señal HRES.`;
}

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest && ev.target.closest("#tc-strike .seg__btn");
  if (!btn) return;
  for (const b of document.querySelectorAll("#tc-strike .seg__btn"))
    b.classList.toggle("is-active", b === btn);
  tc.strike = btn.dataset.value;
  tcStrikeApply();
});

/* ═══════════════  3b. RIESGOS Y ADVERTENCIAS SEVERAS  ═══════════════════
   Evaluación de tiempo peligroso para el punto activo en las próximas
   48 horas: viento, lluvia (inundaciones), tormentas eléctricas y calidad
   del aire. Cada riesgo se clasifica en Bajo / Moderado / Alto / Extremo
   con umbrales meteorológicos; los niveles Alto y Extremo generan
   advertencias serias en lenguaje claro. */

const RISK_LEVELS = [
  { label: "Bajo", color: "#37d67a" },
  { label: "Moderado", color: "#ffb020" },
  { label: "Alto", color: "#ff7a45" },
  { label: "Extremo", color: "#e5484d" },
];

function toKmh(v) {
  return settings.windUnit === "mph" ? v * 1.609344 : v;
}

/* Sol de hoy con día/noche polar bien manejados. Semántica REAL de la
   fuente (sondeada en Svalbard y McMurdo): día polar → daylight 86400 s
   y salida/puesta degeneradas a 00:00; noche polar → daylight 0 s. */
function sunLabel(data) {
  const d = data.daily || {};
  const dl = d.daylight_duration && d.daylight_duration[0];
  if (dl == null) return "—";
  if (dl >= 86390) return t("sun_midnight");
  if (dl <= 10) return t("sun_polar_night");
  const sr = d.sunrise && d.sunrise[0];
  const ss = d.sunset && d.sunset[0];
  if (!sr || !ss) return "—";
  /* con minutos: la salida/puesta a la hora en punto sería mentira */
  return `${sr.slice(11, 16)} – ${ss.slice(11, 16)}`;
}

/* primer índice del arreglo horario que corresponde a "ahora" */
function hourlyStart(data) {
  const t = (data.hourly && data.hourly.time) || [];
  const nowIso = (data.current && data.current.time) || t[0];
  if (!t.length || !nowIso) return 0;
  const i = t.findIndex((x) => x >= nowIso.slice(0, 13) + ":00");
  return i < 0 ? 0 : i;
}

function riskWhen(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}:00`);
  const day = d.toLocaleDateString(tLocale(), { weekday: "short", day: "numeric" });
  return `${day} · ${fmtHour(iso)}`;
}

function computeWindRisk(data, start, end) {
  const H = data.hourly || {};
  if (!H.wind_gusts_10m && !H.wind_speed_10m) return null;
  let maxG = -1;
  let maxGi = -1;
  for (let i = start; i < end; i++) {
    const g = Math.max(
      H.wind_gusts_10m ? (H.wind_gusts_10m[i] ?? -1) : -1,
      H.wind_speed_10m ? (H.wind_speed_10m[i] ?? -1) : -1
    );
    if (g > maxG) {
      maxG = g;
      maxGi = i;
    }
  }
  if (maxG < 0) return null;
  const kmh = toKmh(maxG);
  const level = kmh >= 118 ? 3 : kmh >= 63 ? 2 : kmh >= 40 ? 1 : 0;
  return {
    key: "wind",
    icon: "flag-outline",
    name: "Viento",
    level,
    detail: `Ráfagas de hasta ${Math.round(maxG)} ${windSymbol()}`,
    when: riskWhen(H.time[maxGi]),
    kmh,
  };
}

function computeRainRisk(data, start, end) {
  const H = data.hourly || {};
  if (!H.precipitation) return null;
  let maxR = 0;
  let maxRi = start;
  for (let i = start; i < end; i++) {
    let sum = 0;
    for (let j = i; j < Math.min(i + 6, end); j++)
      sum += H.precipitation[j] ?? 0;
    if (sum > maxR) {
      maxR = sum;
      maxRi = i;
    }
  }
  const level = maxR >= 50 ? 3 : maxR >= 25 ? 2 : maxR >= 10 ? 1 : 0;
  return {
    key: "rain",
    icon: "rainy-outline",
    name: "Lluvia",
    level,
    detail: `Hasta ${Math.round(maxR)} mm en 6 h`,
    when: riskWhen(H.time[maxRi]),
    mm: maxR,
  };
}

function computeStormRisk(data, start, end) {
  const H = data.hourly || {};
  if (!H.cape && !H.weather_code) return null;
  let maxCape = -1;
  let capeI = -1;
  let codeLevel = 0;
  let codeI = -1;
  for (let i = start; i < end; i++) {
    const c = H.cape ? H.cape[i] : null;
    if (c != null && c > maxCape) {
      maxCape = c;
      capeI = i;
    }
    const w = H.weather_code ? H.weather_code[i] : null;
    if (w === 95 && codeLevel < 2) {
      codeLevel = 2;
      codeI = i;
    }
    if ((w === 96 || w === 99) && codeLevel < 3) {
      codeLevel = 3;
      codeI = i;
    }
  }
  const capeLevel = maxCape >= 2500 ? 3 : maxCape >= 1600 ? 2 : maxCape >= 800 ? 1 : 0;
  const level = Math.max(capeLevel, codeLevel);
  const whenI = codeI >= 0 ? codeI : capeI;
  const bits = [];
  if (codeLevel >= 2) bits.push(codeLevel === 3 ? "tormentas con granizo en el pronóstico" : "tormentas eléctricas en el pronóstico");
  if (maxCape >= 800) bits.push(`energía de tormenta (CAPE) de ${Math.round(maxCape)} J/kg`);
  return {
    key: "storm",
    icon: "thunderstorm-outline",
    name: "Tormentas",
    level,
    detail: bits.length ? bits.join(" · ") : "Ambiente estable",
    when: whenI >= 0 ? riskWhen(H.time[whenI]) : "",
    cape: maxCape,
    hail: codeLevel === 3,
  };
}

async function fetchAirRisk(lat, lon, signal) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "us_aqi",
    forecast_days: "2",
    timezone: "auto",
  });
  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`,
    { signal }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const H = data.hourly || {};
  if (!H.us_aqi || !H.time) return null;
  let maxA = -1;
  let maxI = -1;
  /* máximo de las próximas ~24 horas */
  const start = hourlyStart({ hourly: H, current: null });
  for (let i = start; i < Math.min(start + 24, H.time.length); i++) {
    const v = H.us_aqi[i];
    if (v != null && v > maxA) {
      maxA = v;
      maxI = i;
    }
  }
  if (maxA < 0) return null;
  const level = maxA > 200 ? 3 : maxA > 100 ? 2 : maxA > 50 ? 1 : 0;
  return {
    key: "air",
    icon: "leaf-outline",
    name: "Aire",
    level,
    detail: `Índice AQI de hasta ${Math.round(maxA)}`,
    when: riskWhen(H.time[maxI]),
    aqi: maxA,
  };
}

/* advertencias serias para niveles Alto (aviso) y Extremo (advertencia) */
function riskWarning(r) {
  if (!r || r.level < 2) return null;
  const extreme = r.level === 3;
  let title = "";
  let text = "";
  if (r.key === "wind") {
    if (extreme) {
      title = "Vientos con fuerza de huracán";
      text = `${r.detail} (${r.when}). Peligro para la vida al aire libre: permanece en un lugar seguro, aléjate de ventanas y de la costa.`;
    } else {
      title = "Vientos peligrosos";
      text = `${r.detail} (${r.when}), con fuerza de tormenta tropical. Asegura objetos sueltos, evita andamios y precaución al conducir.`;
    }
  } else if (r.key === "rain") {
    if (extreme) {
      title = "Lluvias torrenciales — riesgo de inundaciones repentinas";
      text = `${r.detail} (${r.when}). No cruces ríos, cañadas ni calles inundadas: la corriente puede arrastrar un vehículo.`;
    } else {
      title = "Lluvia fuerte";
      text = `${r.detail} (${r.when}). Posibles inundaciones urbanas y crecidas de ríos; planifica tus traslados.`;
    }
  } else if (r.key === "storm") {
    if (extreme) {
      title = r.hail ? "Tormentas severas con granizo" : "Tormentas severas";
      text = `Ambiente muy inestable (${r.detail}; ${r.when}). Rayos, ráfagas destructivas${r.hail ? ", granizo" : ""} e incluso tornados aislados son posibles. Ten un refugio identificado.`;
    } else {
      title = "Tormentas eléctricas fuertes";
      text = `${r.detail} (${r.when}). Al primer trueno busca techo: los rayos matan. Evita campos abiertos, el mar y árboles aislados.`;
    }
  } else if (r.key === "air") {
    if (extreme) {
      title = "Aire muy dañino para la salud";
      text = `${r.detail} (${r.when}). Evita toda actividad al aire libre; personas con asma, niños y adultos mayores deben permanecer en interiores.`;
    } else {
      title = "Aire dañino";
      text = `${r.detail} (${r.when}). Grupos sensibles (asma, corazón, niños, embarazadas) deben limitar el esfuerzo al aire libre.`;
    }
  }
  return { level: r.level, title, text };
}

let riskSeq = 0;

async function refreshRisks(data, lat, lon, signal) {
  const seq = ++riskSeq;
  const start = hourlyStart(data);
  const end = Math.min(start + 48, ((data.hourly && data.hourly.time) || []).length);

  const risks = [
    computeWindRisk(data, start, end),
    computeRainRisk(data, start, end),
    computeStormRisk(data, start, end),
  ];

  /* coherencia entre medidores: con ambiente de tormenta alto, la lluvia
     convectiva puntual supera por mucho el acumulado del modelo (que puede
     dar ~0 mm). El medidor de lluvia nunca contradice al de tormentas. */
  const rainR = risks[1];
  const stormR = risks[2];
  if (rainR && stormR) {
    const floor = stormR.level >= 3 ? 2 : stormR.level >= 2 ? 1 : 0;
    if (floor > rainR.level) {
      rainR.level = floor;
      rainR.detail =
        rainR.mm >= 2
          ? `Hasta ${Math.round(rainR.mm)} mm en 6 h · aguaceros de tormenta localmente mucho mayores`
          : "Aguaceros de tormenta posibles aunque el acumulado del modelo sea bajo";
      if (stormR.when) rainR.when = stormR.when;
    }
  }

  /* la calidad del aire llega de otro servicio: que no bloquee el resto */
  let air = null;
  try {
    air = await fetchAirRisk(lat, lon, signal);
  } catch (err) {
    if (err && err.name === "AbortError") return;
  }
  risks.push(air);

  if (seq !== riskSeq) return; /* ya se pidió otro punto */
  renderRisks(risks);
}

function renderRisks(risks) {
  const placeholders = { wind: "Viento", rain: "Lluvia", storm: "Tormentas", air: "Aire" };
  const icons = { wind: "flag-outline", rain: "rainy-outline", storm: "thunderstorm-outline", air: "leaf-outline" };

  /* medidores */
  const rows = ["wind", "rain", "storm", "air"].map((key) => {
    const r = risks.find((x) => x && x.key === key);
    if (!r) {
      return `
      <div class="risk">
        <div class="risk__head">
          <ion-icon name="${icons[key]}"></ion-icon>
          <span class="risk__name">${placeholders[key]}</span>
          <strong class="risk__level risk__level--nd">Sin datos</strong>
        </div>
      </div>`;
    }
    const lv = RISK_LEVELS[r.level];
    return `
    <div class="risk">
      <div class="risk__head">
        <ion-icon name="${r.icon}"></ion-icon>
        <span class="risk__name">${r.name}</span>
        <strong class="risk__level" style="color:${lv.color}">${lv.label}</strong>
      </div>
      <div class="risk__bar">
        <span style="width:${((r.level + 1) / 4) * 100}%;background-color:${lv.color}"></span>
      </div>
      <p class="risk__why">${r.detail}${r.when ? ` · ${r.when}` : ""}</p>
    </div>`;
  });
  $("risks").innerHTML = rows.join("");

  /* advertencias, extremas primero */
  const warnings = risks
    .map(riskWarning)
    .filter(Boolean)
    .sort((a, b) => b.level - a.level);

  if (!warnings.length) {
    $("risk-warnings").innerHTML = `
      <p class="risk-clear">
        <ion-icon name="shield-checkmark-outline"></ion-icon>
        Sin advertencias severas activas para este punto.
      </p>`;
    return;
  }
  $("risk-warnings").innerHTML = warnings
    .map(
      (w) => `
    <div class="alertbox ${w.level === 3 ? "alertbox--extreme" : "alertbox--high"}" role="alert">
      <ion-icon name="${w.level === 3 ? "alert-circle" : "warning"}"></ion-icon>
      <div>
        <strong>${w.level === 3 ? "ADVERTENCIA · " : "AVISO · "}${w.title}</strong>
        <span>${w.text}</span>
      </div>
    </div>`
    )
    .join("");
}

/* ═══════════════════════════  4. MAPA  ══════════════════════════════════ */

let map = null;
let weatherLayer = null;
let clickMarker = null;

/* Satélite GOES-19 desde el repo público de datos. CAPA DORMIDA: no se
   pide ni se pinta a la espera de la decisión de Fase 2 (imaginería
   observacional bajo la regla solo-ECMWF). */
const DATA_REPO =
  "https://raw.githubusercontent.com/Innovatiff/fenomenos-datos/main";
let goesData = null; /* {bbox, frames:[{time,url}]} */
let satMode = null; /* "goes" cuando la capa activa usa GOES */

async function loadGoes() {
  try {
    const res = await fetch(`${DATA_REPO}/goes/meta.json`, { cache: "no-cache" });
    if (!res.ok) return;
    const m = await res.json();
    if (!m || !m.bbox || !m.frames || !m.frames.length) return (goesData = null);
    if (Date.now() / 1000 - (m.updated || 0) > 2 * 3600) return (goesData = null);
    goesData = {
      bbox: m.bbox,
      frames: m.frames.map((f) => ({
        time: f.time,
        url: `${DATA_REPO}/goes/${f.file}`,
      })),
    };
    /* precarga: la primera vuelta de la animación sale fluida */
    goesData.frames.forEach((f) => {
      const img = new Image();
      img.src = f.url;
    });
  } catch (_) {}
}

/* Radar propio: MRMS real (~1 km) + lluvia estimada por satélite.
   CAPA DORMIDA igual que GOES (decisión de Fase 2). */
let radarOwn = null; /* {rain:{bbox,frames[]}, mrms:{bboxes,frames[]}|null} */
let radarMode = null; /* "own" cuando la capa activa usa datos propios */

async function loadOwnRadar() {
  try {
    const res = await fetch(`${DATA_REPO}/rain/meta.json`, { cache: "no-cache" });
    if (!res.ok) return;
    const m = await res.json();
    if (!m || !m.bbox || !m.frames || !m.frames.length) return (radarOwn = null);
    if (Date.now() / 1000 - (m.updated || 0) > 2 * 3600) return (radarOwn = null);
    radarOwn = {
      rain: {
        bbox: m.bbox,
        frames: m.frames.map((f) => ({
          time: f.time,
          url: `${DATA_REPO}/rain/${f.file}`,
        })),
      },
      mrms: null,
    };
    radarOwn.rain.frames.slice(-5).forEach((f) => {
      const img = new Image();
      img.src = f.url;
    });
  } catch (_) {
    return;
  }
  try {
    const res = await fetch(`${DATA_REPO}/radar/meta.json`, { cache: "no-cache" });
    if (!res.ok) return;
    const m = await res.json();
    if (!m || !m.frames || !m.frames.length) return;
    if (Date.now() / 1000 - (m.updated || 0) > 2 * 3600) return;
    radarOwn.mrms = {
      bboxes: m.bboxes || {},
      frames: m.frames.map((f) => ({
        time: f.time,
        files: Object.fromEntries(
          Object.entries(f.files || {}).map(([d, p]) => [d, `${DATA_REPO}/radar/${p}`])
        ),
      })),
    };
  } catch (_) {}
}

/* Mosaico mundial GMGSI (horario): capa planetaria bajo las regionales */
let worldSat = null; /* {bbox, ir:[{time,url}], rain:[{time,url}]} */

async function loadWorldSat() {
  try {
    const res = await fetch(`${DATA_REPO}/world/meta.json`, { cache: "no-cache" });
    if (!res.ok) return;
    const m = await res.json();
    if (!m || !m.bbox || !m.ir || !m.ir.length) return (worldSat = null);
    if (Date.now() / 1000 - (m.updated || 0) > 3 * 3600) return (worldSat = null);
    const toFrames = (list) =>
      (list || []).map((f) => ({ time: f.time, url: `${DATA_REPO}/world/${f.file}` }));
    worldSat = { bbox: m.bbox, ir: toFrames(m.ir), rain: toFrames(m.rain) };
    const last = worldSat.ir[worldSat.ir.length - 1];
    if (last) {
      const img = new Image();
      img.src = last.url;
    }
  } catch (_) {}
}

/* Frentes y centros de presión del análisis de superficie de NOAA/WPC
   (el mismo que trazan sus meteorólogos cada 3 horas), ya convertidos a
   JSON por el robot. Se dibujan nativos: líneas por tipo + triángulos y
   semicírculos + letras H/L con su presión. */
let frontsData = null; /* {valid, highs[], lows[], fronts[]} */

async function loadFronts() {
  try {
    const res = await fetch(`${DATA_REPO}/fronts/meta.json`, { cache: "no-cache" });
    if (!res.ok) return;
    const m = await res.json();
    if (!m || !Array.isArray(m.fronts)) return (frontsData = null);
    /* el análisis sale cada 3 h; con más de 9 h se considera caído */
    if (Date.now() / 1000 - (m.updated || 0) > 9 * 3600) return (frontsData = null);
    frontsData = m;
  } catch (_) {}
}

function nearestFrame(frames, time) {
  if (!frames || !frames.length) return null;
  let best = null;
  let bd = Infinity;
  for (const f of frames) {
    if (ownFrameFailed.has(f.url)) continue;
    const d = Math.abs(f.time - time);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

/* fotogramas propios que dieron 404 (podados por el robot): no se vuelven
   a pedir; el refresco de metas los saca de la lista en poco tiempo */
const ownFrameFailed = new Set();
let ownMetaRetryAt = 0;

/* Re-lee las metas del repo de datos y reengancha la capa activa a la
   lista nueva de fotogramas sin cortar la animación. */
let ownRefreshBusy = false;
async function refreshOwnData() {
  if (ownRefreshBusy) return;
  ownRefreshBusy = true;
  try {
    /* frentes: lo único vivo del bloque de datos observacionales; el
       resto (GOES/MRMS/mosaico) duerme hasta la decisión de Fase 2 */
    try {
      await loadFronts();
      frontsApply();
    } catch (_) {}
    /* ciclones tropicales del ENS (producto de cada pasada); un fallo de
       un producto no debe bloquear al otro */
    try {
      await loadCiclones();
      tcApply();
      tcRender();
    } catch (_) {}
    /* capa Nubes activa: engancha los fotogramas nuevos sin cortar nada */
    try {
      if (activeKind === "clouds" && weatherLayer === "obs") {
        const wasPlaying = playing;
        await Promise.all([loadWorldSat(), loadGoes()]);
        const base = goesData ? goesData.frames : worldSat ? worldSat.ir : [];
        if (base.length && activeKind === "clouds") {
          const atEnd = frameIndex >= frames.length - 1;
          frames = base;
          frameIndex = atEnd ? frames.length - 1 : Math.min(frameIndex, frames.length - 1);
          const os = $("obs-slider");
          if (os) os.max = String(frames.length - 1);
          if (!wasPlaying) {
            satShow(frames[frameIndex]);
            paintFrameLabel();
          }
        }
      }
    } catch (_) {}
    if (ownFrameFailed.size > 400) ownFrameFailed.clear();
  } finally {
    ownRefreshBusy = false;
  }
}

/* RainViewer — DORMIDO: sin llamadores desde la purga solo-ECMWF; el
   radar observacional vuelve (o no) con la decisión de Fase 2 */
let rvData = null;
let frames = [];
let frameIndex = 0;
let playing = false;
let playTimer = null;
let activeKind = "radar";

/* Estilos vectoriales oscuros, en orden de preferencia: OpenFreeMap
   (gratis e ilimitado) y, de respaldo, el estilo GL oscuro de CARTO. */
const MAP_STYLES = [
  "https://tiles.openfreemap.org/styles/dark",
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
];

function waitForMapLib(timeoutMs = 6000) {
  return new Promise((resolve) => {
    const started = Date.now();
    (function check() {
      if (window.maplibregl) return resolve(window.maplibregl);
      if (Date.now() - started > timeoutMs) return resolve(null);
      setTimeout(check, 120);
    })();
  });
}

async function resolveMapStyle() {
  /* failover entre proveedores + reintentos con espera creciente: un
     tropiezo de red no debe dejar al usuario sin mapa */
  for (let intento = 0; intento < 3; intento++) {
    if (intento > 0)
      await new Promise((r) => setTimeout(r, 700 * Math.pow(2, intento)));
    for (const url of MAP_STYLES) {
      try {
        const res = await fetch(url);
        if (res.ok) return url;
      } catch (_) {}
    }
  }
  return null;
}

/* MapLibre y Leaflet numeran el zoom con ~1 nivel de diferencia */
function glZoom(z) {
  return Math.max(2, z - 1);
}

let labelsAnchor; /* primera capa de rótulos del estilo base */
let weatherAnchor; /* capa base de los frentes: el tiempo se pinta debajo */

/* ── proyección: globo (v5) o Mercator plano, a elección del usuario ──
   En globo no hay copias del mundo ni bordes: se quitan los límites de
   arrastre. En Mercator vuelven los límites un pelo por dentro de ±180°
   (el mundo completo exacto hacía fallar el constreñimiento interno). */
function projectionApply() {
  if (!map) return;
  const globo = settings.globe !== false;
  try {
    if (map.setProjection) map.setProjection({ type: globo ? "globe" : "mercator" });
    if (map.setMaxBounds) {
      map.setMaxBounds(
        globo
          ? null
          : [
              [-179.9, -80],
              [179.9, 84],
            ]
      );
    }
  } catch (_) {
    /* si el navegador/versión no lo soporta, el mapa sigue vivo plano */
  }
  const btn = $("globe-btn");
  if (btn) btn.classList.toggle("is-active", globo);
}

async function initMap() {
  if (map) return; /* reintento con el mapa ya vivo: nada que hacer */
  const gl = await waitForMapLib();
  const styleUrl = gl ? await resolveMapStyle() : null;
  if (!gl || !styleUrl) {
    /* degradado pero usable: el panel de pronóstico sigue funcionando y
       la tarjeta ofrece reintentar (ya no es un callejón sin salida) */
    $("map-fallback").classList.add("is-visible");
    return;
  }
  $("map-fallback").classList.remove("is-visible");

  const c = countryGet(settings.country) || COUNTRIES.do;
  const dc = window.__fdcDeepCenter; /* [lat, lon, zoom] del enlace */
  map = new gl.Map({
    container: "map",
    style: styleUrl,
    center: dc ? [dc[1], dc[0]] : [c.lon, c.lat],
    zoom: dc ? dc[2] : glZoom(c.zoom),
    minZoom: 2,
    /* el estilo vectorial es nítido a cualquier zoom y la base satelital
       llega a ~19: acercarse mucho ya no se ve pixelado */
    maxZoom: 18,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    /* un solo mundo: sin copias infinitas a los lados */
    renderWorldCopies: false,
    /* exportar imagen del mapa (botón Compartir) necesita el buffer */
    preserveDrawingBuffer: true,
  });
  if (map.touchZoomRotate && map.touchZoomRotate.disableRotation)
    map.touchZoomRotate.disableRotation();
  projectionApply();
  window.__fdcMap = map; /* para depurar */
  map.addControl(new gl.NavigationControl({ showCompass: false }), "top-left");
  map.addControl(new gl.ScaleControl({ unit: "metric" }), "bottom-left");

  await new Promise((resolve) => map.on("load", resolve));

  /* las capas de tiempo se insertan DEBAJO de los rótulos del estilo:
     los nombres de lugares siempre se leen encima de radar y modelos */
  const styleLayers = (map.getStyle() && map.getStyle().layers) || [];
  const sym = styleLayers.find((l) => l.type === "symbol");
  labelsAnchor = sym ? sym.id : undefined;
  weatherAnchor = labelsAnchor;
  /* la base satelital se mete bajo fronteras y rótulos: tapa los rellenos
     del estilo pero deja leer límites y nombres encima, como una app real */
  const satAnchor = styleLayers.find(
    (l) => l.type === "symbol" || /boundary|admin/i.test(l.id)
  );
  satBaseAnchor = satAnchor ? satAnchor.id : labelsAnchor;
  frontsInitLayers();
  tcInitLayers();
  tcApply();
  /* el estilo puede traer su propia proyección: se re-aplica la elegida */
  projectionApply();

  $("map-credit").hidden = false;

  /* algunos estilos de respaldo referencian iconos de sprite que no
     existen (p. ej. "circle-11"): se responde con un pixel transparente
     para que la consola no se llene de avisos */
  map.on("styleimagemissing", (e) => {
    try {
      if (map.hasImage && map.hasImage(e.id)) return;
      map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    } catch (_) {}
  });

  /* el robot re-publica cada 10 min y borra fotogramas viejos: si un
     fotograma da 404 se marca para no volver a pedirlo y se re-leen las
     metas (con freno) para engancharse a la lista nueva */
  map.on("error", (e) => {
    const err = e && e.error;
    const url =
      (err && err.url) ||
      ((err && err.message && err.message.match(/https?:\/\/\S+/)) || [])[0] ||
      "";
    if (!url.includes("fenomenos-datos")) return;
    ownFrameFailed.add(url);
    const now = Date.now();
    if (now > ownMetaRetryAt) {
      ownMetaRetryAt = now + 60 * 1000;
      refreshOwnData();
    }
  });

  map.on("click", onMapClick);
  map.on("moveend", updateLink);
  map.on("moveend", () => {
    if (euro.on) euroRefreshSoon();
  });

  /* las partículas se congelan mientras el mapa se mueve y se
     recolocan al soltar (si no, quedarían "pegadas" a la pantalla) */
  map.on("movestart", () => {
    if (wind.raf) windStop();
  });
  map.on("zoomstart", () => {
    if (wind.raf) windStop();
  });
  map.on("moveend", () => {
    if (euro.on) windEnsure();
  });
  map.on("zoomend", () => {
    if (euro.on) windEnsure();
  });

  /* Solo se piden los datos que la vista ACTUAL usa: frentes WPC. Las
     capas de satélite/radar están dormidas (decisión de Fase 2) y sus
     metas no se piden — cero red gastada sin efecto visible. */
  await loadFronts();
  setLayer(settings.layer, { silent: true });
  frontsApply();
  /* ciclones tropicales del ENS: producto propio de cada pasada */
  await loadCiclones();
  tcApply();
  tcRender();

  /* con la pestaña abierta mucho rato, las metas caducan: refresco cada
     5 min para que los frentes sigan siempre al día */
  setInterval(refreshOwnData, 5 * 60 * 1000);
}

/* ── capas ráster del tiempo (radar/satélite) sobre el estilo ── */
/* ── base satelital de alta resolución (solo con la capa Satélite) ──
   Imágenes de Esri World Imagery: nítidas hasta zoom ~19 en todo el
   mundo. Se crea una vez y solo se alterna su visibilidad. */
const SAT_BASE_SRC = "sat-base";
const SAT_BASE_LAYER = "sat-base-layer";
let satBaseAnchor;

function satBaseShow(on) {
  if (!map || !map.getLayer) return;
  try {
    if (!map.getSource(SAT_BASE_SRC)) {
      map.addSource(SAT_BASE_SRC, {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© Esri · Maxar · Earthstar Geographics",
      });
      map.addLayer(
        {
          id: SAT_BASE_LAYER,
          type: "raster",
          source: SAT_BASE_SRC,
          layout: { visibility: "none" },
          paint: { "raster-fade-duration": 150 },
        },
        satBaseAnchor
      );
    }
    map.setLayoutProperty(
      SAT_BASE_LAYER,
      "visibility",
      on ? "visible" : "none"
    );
  } catch (_) {
    /* sin base satelital el mapa vectorial sigue siendo válido */
  }
}

const WX_SOURCE = "wx-tiles";
const WX_LAYER = "wx-tiles-layer";

function weatherTilesRemove() {
  if (!map || !map.getLayer) return;
  if (map.getLayer(WX_LAYER)) map.removeLayer(WX_LAYER);
  if (map.getSource(WX_SOURCE)) map.removeSource(WX_SOURCE);
}

function weatherTilesSet(url, opacity) {
  weatherTilesRemove();
  map.addSource(WX_SOURCE, {
    type: "raster",
    tiles: [url],
    tileSize: 256,
    maxzoom: 12,
  });
  map.addLayer(
    {
      id: WX_LAYER,
      type: "raster",
      source: WX_SOURCE,
      paint: { "raster-opacity": opacity, "raster-fade-duration": 150 },
    },
    weatherAnchor
  );
}

/* ── 4a-bis. FRENTES DEL ANÁLISIS DE SUPERFICIE (NOAA WPC) ─────────────
   Capas creadas una sola vez (vacías) justo debajo de los rótulos; las
   capas de tiempo (radar, satélite, modelos) se insertan DEBAJO de ellas
   para que los frentes siempre se lean encima. */
const FRONT_COLD = "#5aa2ff";
const FRONT_WARM = "#ff5a5a";
const FRONT_OCC = "#c07ae8";
const FRONT_TROF = "#ffb020";

function frontPipImages() {
  if (!map.addImage || typeof document === "undefined") return;
  const mk = (w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w * 2;
    c.height = h * 2;
    const g = c.getContext("2d");
    g.scale(2, 2);
    draw(g);
    return { width: w * 2, height: h * 2, data: g.getImageData(0, 0, w * 2, h * 2).data };
  };
  const tri = (g, x, y, up, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x - 7, y);
    g.lineTo(x + 7, y);
    g.lineTo(x, up ? y - 9 : y + 9);
    g.closePath();
    g.fill();
  };
  const semi = (g, x, y, up, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, 7, up ? Math.PI : 0, up ? 0 : Math.PI);
    g.closePath();
    g.fill();
  };
  const imgs = {
    "pip-cold": mk(16, 12, (g) => tri(g, 8, 11, true, FRONT_COLD)),
    "pip-warm": mk(16, 12, (g) => semi(g, 8, 11, true, FRONT_WARM)),
    "pip-ocfnt": mk(34, 12, (g) => {
      tri(g, 8, 11, true, FRONT_OCC);
      semi(g, 26, 11, true, FRONT_OCC);
    }),
    /* estacionario: triángulo azul a un lado, semicírculo rojo al otro */
    "pip-stnry": mk(34, 22, (g) => {
      tri(g, 8, 11, true, FRONT_COLD);
      semi(g, 26, 11, false, FRONT_WARM);
    }),
  };
  for (const [id, img] of Object.entries(imgs)) {
    try {
      if (!map.hasImage || !map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
    } catch (_) {}
  }
}

function frontsInitLayers() {
  if (!map.addSource) return;
  try {
    const empty = { type: "FeatureCollection", features: [] };
    map.addSource("fronts", { type: "geojson", data: empty });
    map.addSource("front-centers", { type: "geojson", data: empty });
    frontPipImages();

    const vis = settings.fronts === false ? "none" : "visible";
    const addL = (def) => {
      def.layout = Object.assign({ visibility: vis }, def.layout || {});
      map.addLayer(def, labelsAnchor);
    };

    /* líneas (la primera capa es también el ancla de las capas de tiempo) */
    addL({
      id: "front-lines",
      type: "line",
      source: "fronts",
      filter: ["in", ["get", "type"], ["literal", ["cold", "warm", "ocfnt"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-width": 2.6,
        "line-color": [
          "match",
          ["get", "type"],
          "cold",
          FRONT_COLD,
          "warm",
          FRONT_WARM,
          FRONT_OCC,
        ],
      },
    });
    /* estacionario: base roja continua + trazos azules encima = alternado */
    addL({
      id: "front-stnry-base",
      type: "line",
      source: "fronts",
      filter: ["==", ["get", "type"], "stnry"],
      paint: { "line-width": 2.6, "line-color": FRONT_WARM },
    });
    addL({
      id: "front-stnry-dash",
      type: "line",
      source: "fronts",
      filter: ["==", ["get", "type"], "stnry"],
      paint: {
        "line-width": 2.6,
        "line-color": FRONT_COLD,
        "line-dasharray": [2.2, 2.2],
      },
    });
    addL({
      id: "front-trof",
      type: "line",
      source: "fronts",
      filter: ["==", ["get", "type"], "trof"],
      layout: { "line-cap": "round" },
      paint: {
        "line-width": 2.2,
        "line-color": FRONT_TROF,
        "line-dasharray": [2.6, 2.2],
      },
    });

    /* pips a lo largo de la línea, girando con ella */
    for (const t of ["cold", "warm", "ocfnt", "stnry"]) {
      addL({
        id: `front-pips-${t}`,
        type: "symbol",
        source: "fronts",
        filter: ["==", ["get", "type"], t],
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": t === "cold" || t === "warm" ? 64 : 92,
          "icon-image": `pip-${t}`,
          "icon-size": 0.9,
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-offset": [0, t === "stnry" ? 0 : -7],
        },
      });
    }

    /* centros de presión: H azul / L roja + presión debajo. La fuente se
       toma del propio estilo base para no pedir glifos inexistentes */
    let font = ["Noto Sans Regular"];
    try {
      const ls = (map.getStyle() && map.getStyle().layers) || [];
      const s = ls.find(
        (l) =>
          l.type === "symbol" &&
          l.layout &&
          Array.isArray(l.layout["text-font"]) &&
          l.layout["text-font"].length
      );
      if (s) font = s.layout["text-font"];
    } catch (_) {}
    addL({
      id: "front-hl",
      type: "symbol",
      source: "front-centers",
      layout: {
        "text-field": ["get", "kind"],
        "text-size": 24,
        "text-font": font,
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": ["match", ["get", "kind"], "H", FRONT_COLD, FRONT_WARM],
        "text-halo-color": "#0b1017",
        "text-halo-width": 1.6,
      },
    });
    addL({
      id: "front-hl-p",
      type: "symbol",
      source: "front-centers",
      filter: ["has", "p"],
      layout: {
        "text-field": ["to-string", ["get", "p"]],
        "text-size": 10.5,
        "text-font": font,
        "text-offset": [0, 1.7],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#c8d2e0",
        "text-halo-color": "#0b1017",
        "text-halo-width": 1.2,
      },
    });

    weatherAnchor = "front-lines";
  } catch (_) {
    weatherAnchor = labelsAnchor;
  }
}

/* suavizado de Chaikin: el boletín trae vértices cada ~1° y las rectas se
   ven angulosas; dos pasadas dan la curva suave del análisis dibujado */
function chaikin(points, iterations) {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

function frontsApply() {
  if (!map || !map.getSource) return;
  const src = map.getSource("fronts");
  const ctr = map.getSource("front-centers");
  if (!src || !src.setData || !ctr || !ctr.setData) return;
  if (!frontsData) {
    const empty = { type: "FeatureCollection", features: [] };
    src.setData(empty);
    ctr.setData(empty);
    return;
  }
  src.setData({
    type: "FeatureCollection",
    features: frontsData.fronts.map((f) => ({
      type: "Feature",
      properties: { type: f.type },
      geometry: { type: "LineString", coordinates: chaikin(f.points, 2) },
    })),
  });
  const center = (kind) => (c) => ({
    type: "Feature",
    properties: c.p ? { kind, p: c.p } : { kind },
    geometry: { type: "Point", coordinates: [c.lon, c.lat] },
  });
  ctr.setData({
    type: "FeatureCollection",
    features: [
      ...(frontsData.highs || []).map(center("H")),
      ...(frontsData.lows || []).map(center("L")),
    ],
  });
}

const FRONT_LAYER_IDS = [
  "front-lines",
  "front-stnry-base",
  "front-stnry-dash",
  "front-trof",
  "front-pips-cold",
  "front-pips-warm",
  "front-pips-ocfnt",
  "front-pips-stnry",
  "front-hl",
  "front-hl-p",
];

function frontsSetVisible(on) {
  if (!map || !map.setLayoutProperty) return;
  for (const id of FRONT_LAYER_IDS) {
    try {
      if (map.getLayer(id))
        map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    } catch (_) {}
  }
}

function onMapClick(e) {
  const { lat, lng } = e.lngLat;
  const label = `${lat.toFixed(2)}, ${lng.toFixed(2)}`;

  if (clickMarker) clickMarker.remove();
  const gl = window.maplibregl;
  clickMarker = new gl.Marker({ color: "#ffb020" })
    .setLngLat([lng, lat])
    .setPopup(
      new gl.Popup({ offset: 18, closeButton: false }).setHTML(
        `Pronóstico para <strong>${label}</strong>${euroReadout(lat, lng)}`
      )
    )
    .addTo(map);
  clickMarker.togglePopup();

  loadWeather(lat, lng, `Punto ${label}`);
  reverseGeocode(lat, lng);
}

/* nombre legible del punto tocado. El endpoint anterior (geocoding de
   Open-Meteo con name vacío) NO hace geocodificación inversa — sondeado
   en vivo devuelve solo {"generationtime_ms":…} sin resultados (corrida
   30369449924). Ahora: Photon (komoot, OSM) con respaldo Nominatim,
   con caché y como máximo una petición por clic (política de uso). */
const revCache = new Map();
let revLast = 0;

async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(2)}|${lon.toFixed(2)}`;
  const apply = (label) => {
    if (label && currentSpot && Math.abs(currentSpot.lat - lat) < 0.001) {
      $("now-place").textContent = label;
      currentSpot.label = label;
    }
  };
  if (revCache.has(key)) return apply(revCache.get(key));
  const now = Date.now();
  if (now - revLast < 1100) return; /* cortesía: nunca más de ~1 pet./s */
  revLast = now;
  const pick = (name, city, state, country) => {
    const main = name || city;
    if (!main) return null;
    const extra = [city && city !== main ? city : null, state, country]
      .filter(Boolean)
      .slice(0, 2)
      .join(", ");
    return extra ? `${main}, ${extra}` : main;
  };
  let label = null;
  try {
    const res = await fetch(
      `https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&lang=default`
    );
    if (res.ok) {
      const d = await res.json();
      const p = d.features && d.features[0] && d.features[0].properties;
      if (p) label = pick(p.name, p.city, p.state, p.country);
    }
  } catch (_) {}
  if (!label) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&format=jsonv2&accept-language=es&zoom=12`
      );
      if (res.ok) {
        const d = await res.json();
        const a = d.address || {};
        label = pick(
          d.name || a.city || a.town || a.village,
          a.city || a.town || a.village,
          a.state,
          a.country
        );
      }
    } catch (_) {}
  }
  /* mar abierto u error: se queda la etiqueta honesta de coordenadas */
  if (label) revCache.set(key, label);
  if (revCache.size > 200) revCache.delete(revCache.keys().next().value);
  apply(label);
}

async function loadRainViewer() {
  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rvData = await res.json();
  } catch (_) {
    rvData = null;
  }
}

function framesFor(kind) {
  if (!rvData) return [];
  if (kind === "radar") {
    const radar = rvData.radar || {};
    return [...(radar.past || []), ...(radar.nowcast || [])];
  }
  if (kind === "satellite") {
    const sat = rvData.satellite || {};
    return [...(sat.infrared || [])];
  }
  return [];
}

function tileUrl(kind, frame) {
  const host = rvData.host || "https://tilecache.rainviewer.com";
  return kind === "radar"
    ? `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`
    : `${host}${frame.path}/256/{z}/{x}/{y}/0/0_0.png`;
}

function setLayer(kind, { silent = false } = {}) {
  activeKind = kind;

  document
    .querySelectorAll("#layer-seg .seg__btn")
    .forEach((b) => b.classList.toggle("is-active", b.dataset.layer === kind));

  stopPlayback();
  if (weatherLayer) {
    weatherTilesRemove();
    weatherLayer = null;
  }
  satOverlayRemove();
  satMode = null;
  radarOwnRemove();
  radarMode = null;

  /* con Satélite el suelo es imagen real de alta resolución */
  satBaseShow(kind === "satellite");

  /* Mapa = cartográfico · Satélite = imagen real: en ambos el protagonista
     es SOLO el modelo ECMWF. «Nubes» es OBSERVACIÓN pura: satélite
     GOES/mosaico mundial real, sin modelo encima (y así se rotula).
     "Sin capa" deja el mapa limpio. */
  euroSetActive(kind === "radar" || kind === "satellite", { silent });
  if (kind === "clouds") cloudsEnable();
  else $("playbar").classList.remove("is-visible");
  updateLink();
}

/* ═══ capa «Nubes»: satélite OBSERVACIONAL (decisión Fase 2 del dueño) ═══
   Mosaico mundial GMGSI (horario, ±72°) debajo y GOES-19 (cada 10 min,
   América) encima. Es observación de NOAA — no es el modelo ECMWF y por
   eso vive en su propia capa, sin mezclarse con el pronóstico. */
async function cloudsEnable() {
  await Promise.all([loadWorldSat(), loadGoes()]);
  if (activeKind !== "clouds") return; /* el usuario ya cambió de capa */
  const base = goesData ? goesData.frames : worldSat ? worldSat.ir : [];
  if (!base.length) {
    frames = [];
    weatherLayer = null;
    $("frame-time").textContent = "sin datos";
    $("frame-kind").textContent = "Satélite (obs)";
    $("playbar").classList.add("is-visible");
    const os = $("obs-slider");
    if (os) os.hidden = true;
    return;
  }
  frames = base;
  weatherLayer = "obs";
  satMode = "goes"; /* stepFrame reutiliza el camino GOES+mundo */
  frameIndex = frames.length - 1; /* arranca en lo más reciente */
  satShow(frames[frameIndex]);
  $("frame-kind").textContent = goesData
    ? "GOES-19 + mosaico IR (obs)"
    : "Mosaico mundial IR (obs)";
  paintFrameLabel();
  const os = $("obs-slider");
  if (os) {
    os.hidden = false;
    os.max = String(frames.length - 1);
    os.value = String(frameIndex);
  }
  $("playbar").classList.add("is-visible");
}

function paintFrameLabel() {
  const frame = frames[frameIndex];
  if (!frame) return;
  const date = new Date(frame.time * 1000);
  const isFuture = frame.time * 1000 > Date.now();
  $("frame-time").textContent = `${fmtClock(date)}${isFuture ? " (pronóstico)" : ""}`;
  const os = $("obs-slider");
  if (os && !os.hidden) os.value = String(frameIndex);
}

function stepFrame() {
  if (!frames.length || !weatherLayer || !map) return;
  frameIndex = (frameIndex + 1) % frames.length;
  if (radarMode === "own") {
    radarOwnShow(frames[frameIndex]);
  } else if (satMode === "goes") {
    satShow(frames[frameIndex]);
  } else {
    const src2 = map.getSource(WX_SOURCE);
    if (src2 && src2.setTiles)
      src2.setTiles([tileUrl(activeKind, frames[frameIndex])]);
  }
  paintFrameLabel();
}

function startPlayback() {
  if (!frames.length || !weatherLayer) return;
  playing = true;
  $("play-icon").setAttribute("name", "pause");
  playTimer = setInterval(stepFrame, 700);
}

function stopPlayback() {
  playing = false;
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  const icon = $("play-icon");
  if (icon) icon.setAttribute("name", "play");
}

/* ═══════════════  4b. MODELO EUROPEO (ECMWF · IFS)  ═════════════════════
   Capa de tiempo peligroso sobre el mapa. Dos modos:
   · Probabilidad — porcentaje de los 51 escenarios del ensemble IFS que
     superan un umbral peligroso (viento sostenido > 25 mph, ráfagas
     > 40 mph, lluvia > 25 mm en 6 h) en cada período de 6 horas.
   · Determinista — la pasada real de alta resolución del IFS: el máximo
     (o el total, para lluvia) de cada período de 6 horas.
   Los datos llegan de Open-Meteo (que redistribuye el IFS de ECMWF sin
   clave) en una rejilla de puntos que cubre la vista del mapa; el campo
   se pinta en un canvas y se estira como imagen suavizada sobre el mapa. */

const EURO_HOURS = 6; /* ancho de cada período */
const EURO_DAYS = 4; /* alcance del pronóstico */

/* SOLO ECMWF. Las dos variantes son del mismo centro (ECMWF):
   · IFS — determinista 0.25° + EPS (ensemble de 51 escenarios)
   · AIFS — el modelo de IA de ECMWF (operacional desde 2025); su
     selector de variante llegará en la Fase 1 del plan global. */
const EURO_MODELS_CFG = {
  ecmwf: {
    name: "ECMWF",
    det: "ecmwf_ifs025",
    ens: "ecmwf_ifs025",
    detLabel: "IFS de ECMWF · determinista (0.25°)",
    ensName: "EPS de ECMWF",
    fallbackMembers: 51,
  },
  aifs: {
    name: "AIFS (IA)",
    det: "ecmwf_aifs025_single",
    ens: "ecmwf_aifs025",
    detLabel: "AIFS de ECMWF · IA determinista (0.25°)",
    ensName: "AIFS-ENS de ECMWF (IA)",
    fallbackMembers: 51,
  },
};

/* rampa de colores para probabilidades (0–100 %) */
const EURO_PROB_STOPS = [
  [0, [255, 224, 138, 0]],
  [5, [255, 224, 138, 45]],
  [15, [255, 224, 138, 150]],
  [30, [255, 176, 32, 185]],
  [50, [255, 122, 69, 205]],
  [70, [229, 72, 77, 222]],
  [90, [186, 60, 190, 235]],
  [100, [148, 40, 190, 245]],
];
const EURO_PROB_TICKS = [10, 30, 50, 70, 90];

const EURO_VARS = {
  wind: {
    hourly: "wind_speed_10m",
    agg: "max",
    unit: "mph",
    threshold: 25,
    probTitle: "Probabilidad de viento sostenido > 25 mph (40 km/h)",
    detTitle: "Viento sostenido máximo del período (mph)",
    probShort: "P(viento > 25 mph)",
    detShort: "Viento máx.",
    detStops: [
      [8, [70, 150, 165, 0]],
      [12, [70, 160, 170, 120]],
      [18, [110, 190, 120, 150]],
      [25, [255, 224, 90, 185]],
      [32, [255, 176, 32, 205]],
      [40, [255, 110, 60, 220]],
      [50, [229, 60, 70, 232]],
      [62, [200, 60, 200, 242]],
    ],
    detTicks: [12, 25, 40, 62],
  },
  gusts: {
    hourly: "wind_gusts_10m",
    agg: "max",
    preceding: true,
    unit: "mph",
    threshold: 40,
    probTitle: "Probabilidad de ráfagas > 40 mph (64 km/h)",
    detTitle: "Ráfaga máxima del período (mph)",
    probShort: "P(ráfagas > 40 mph)",
    detShort: "Ráfaga máx.",
    detStops: [
      [12, [70, 150, 165, 0]],
      [20, [70, 160, 170, 120]],
      [28, [110, 190, 120, 150]],
      [40, [255, 224, 90, 185]],
      [50, [255, 176, 32, 205]],
      [58, [255, 110, 60, 220]],
      [70, [229, 60, 70, 232]],
      [85, [200, 60, 200, 242]],
    ],
    detTicks: [20, 40, 60, 85],
  },
  rain: {
    hourly: "precipitation",
    agg: "sum",
    preceding: true,
    unit: "mm",
    threshold: 25,
    probTitle: "Probabilidad de lluvia > 25 mm en 6 h (riesgo de inundaciones)",
    detTitle: "Lluvia acumulada en 6 h (mm)",
    probShort: "P(lluvia > 25 mm/6 h)",
    detShort: "Lluvia 6 h",
    detStops: [
      [0.5, [90, 150, 255, 0]],
      [2, [90, 150, 255, 125]],
      [6, [70, 190, 240, 155]],
      [12, [90, 220, 150, 180]],
      [25, [255, 224, 90, 200]],
      [40, [255, 150, 40, 215]],
      [60, [229, 60, 70, 230]],
      [100, [200, 60, 200, 242]],
    ],
    detTicks: [2, 25, 60, 100],
  },
  /* Temperatura a 2 m: campo continuo, solo determinista (un umbral de
     probabilidad no significa nada útil aquí). Las imágenes mundiales
     vienen del robot en °C; la rampa es la misma de allá. */
  temp: {
    hourly: "temperature_2m",
    agg: "max",
    unit: "°C",
    threshold: null,
    detTitle: "Temperatura a 2 m (máx. del período, °C)",
    detShort: "Temp.",
    detStops: [
      [-40, [130, 60, 180, 215]],
      [-30, [90, 70, 200, 215]],
      [-20, [60, 110, 230, 215]],
      [-10, [70, 160, 240, 215]],
      [0, [90, 200, 220, 215]],
      [5, [80, 210, 160, 215]],
      [10, [110, 220, 110, 215]],
      [15, [180, 230, 90, 215]],
      [20, [235, 225, 80, 215]],
      [25, [250, 180, 60, 215]],
      [30, [250, 120, 50, 215]],
      [35, [235, 60, 45, 215]],
      [40, [180, 30, 60, 215]],
      [45, [120, 20, 60, 215]],
    ],
    detTicks: [-20, 0, 20, 40],
  },
  /* Calidad del aire: índice AQI de EE. UU. del CAMS (Copernicus).
     No es un modelo meteorológico con ensemble: solo modo determinista. */
  air: {
    hourly: "us_aqi",
    agg: "max",
    unit: "AQI",
    threshold: null,
    detTitle: "Calidad del aire — índice AQI (EE. UU.)",
    detShort: "AQI máx.",
    detStops: [
      [0, [0, 200, 80, 0]],
      [25, [0, 210, 90, 90]],
      [50, [190, 230, 60, 140]],
      [100, [255, 214, 40, 185]],
      [150, [255, 126, 0, 210]],
      [200, [235, 50, 50, 225]],
      [300, [143, 63, 151, 238]],
      [400, [126, 0, 35, 245]],
    ],
    detTicks: [50, 100, 150, 200, 300],
  },
};

/* variables SIN ensemble (siempre deterministas): aire y temperatura */
function euroDetOnly(v) {
  return v === "air" || v === "temp";
}

const euro = {
  on: false,
  model: "ecmwf",
  variable: "wind",
  mode: "prob",
  step: null,
  data: null,
  overlay: null,
  cache: new Map(),
  abort: null,
  seq: 0,
  /* control de tráfico hacia la API */
  lastFetch: { prob: 0, det: 0, wind: 0 },
  cooldownUntil: 0,
  inflightKey: null,
  retryTimer: null,
};
window.__fdcEuro = euro; /* para depurar */

/* El ensemble pesa mucho en la cuota de Open-Meteo: entre peticiones
   automáticas (paneos) se respeta un intervalo mínimo por modo. Cambiar
   de variable o de modo a mano lo salta (ver los controles del panel). */
const EURO_MIN_INTERVAL = { prob: 20000, det: 8000 };

/* Rejilla de puntos que SIEMPRE cubre la vista actual: el espaciado se
   calcula en continuo (cuantizado a 0.25°, la malla nativa del IFS) para
   que quepan dentro de los topes de filas/columnas sin dejar huecos, y se
   alinea a múltiplos del espaciado para que pequeños desplazamientos del
   mapa reutilicen la caché. */
function euroGrid(maxCols, maxRows) {
  const b = map.getBounds();
  const latN = Math.min(b.getNorth(), 74);
  const latS = Math.max(b.getSouth(), -60);
  let lonW = b.getWest();
  let lonE = b.getEast();
  if (lonE - lonW >= 358) {
    lonW = -179;
    lonE = 179;
  }
  const need = Math.max(
    (lonE - lonW) / (maxCols - 2),
    (latN - latS) / (maxRows - 2),
    0.25
  );
  const sp = Math.ceil(need / 0.25) * 0.25;
  const lat0 = Math.min(76, Math.ceil(latN / sp) * sp);
  const lon0 = Math.floor(lonW / sp) * sp;
  const rows = Math.max(2, Math.ceil((lat0 - latS) / sp) + 1);
  const cols = Math.max(2, Math.ceil((lonE - lon0) / sp) + 1);
  const lats = Array.from({ length: rows }, (_, r) => lat0 - r * sp);
  const lons = Array.from({ length: cols }, (_, c) => lon0 + c * sp);
  return { lats, lons, sp, key: `${sp}|${lat0}|${lon0}|${rows}x${cols}` };
}

/* ¿Los datos en pantalla todavía cubren la vista pedida? Si sí, no hace
   falta pedir nada: así un paseo por el mapa no quema la cuota de la API. */
function euroCovered(reqGrid) {
  const d = euro.data;
  if (!d || !d.at || Date.now() - d.at > EURO_CACHE_TTL) return false;
  const isAir = euro.variable === "air";
  const effMode = euroDetOnly(euro.variable) ? "det" : euro.mode;
  if (d.variable !== euro.variable) return false;
  if (!isAir && (d.mode !== effMode || d.model !== euro.model)) return false;
  if (d.grid.sp > reqGrid.sp * 1.7) return false; /* muy grueso para este zoom */
  const h = d.grid.sp / 2;
  const dN = d.grid.lats[0] + h;
  const dS = d.grid.lats[d.grid.lats.length - 1] - h;
  const dW = d.grid.lons[0] - h;
  const dE = d.grid.lons[d.grid.lons.length - 1] + h;
  return (
    dN >= reqGrid.lats[0] &&
    dS <= reqGrid.lats[reqGrid.lats.length - 1] &&
    dW <= reqGrid.lons[0] &&
    dE >= reqGrid.lons[reqGrid.lons.length - 1]
  );
}

function euroNormLon(x) {
  return ((((x + 180) % 360) + 360) % 360) - 180;
}

function euroPointParams(grid) {
  const latQ = [];
  const lonQ = [];
  for (const lat of grid.lats)
    for (const lon of grid.lons) {
      latQ.push(lat.toFixed(3));
      lonQ.push(euroNormLon(lon).toFixed(3));
    }
  return { latQ, lonQ };
}

/* agrega las horas de un período: máximo (viento) o suma (lluvia).
   La lluvia y las ráfagas de Open-Meteo describen la HORA PRECEDENTE al
   sello de tiempo, así que su ventana se corre un índice para que el
   período etiquetado t…t+6 agregue exactamente esas seis horas. */
function euroWindow(values, cfg, step) {
  if (!values) return null;
  let out = cfg.agg === "sum" ? 0 : -Infinity;
  let seen = false;
  const from = step * EURO_HOURS + (cfg.preceding ? 1 : 0);
  for (let h = from; h < from + EURO_HOURS && h < values.length; h++) {
    const v = values[h];
    if (v == null || Number.isNaN(v)) continue;
    seen = true;
    if (cfg.agg === "sum") out += v;
    else if (v > out) out = v;
  }
  return seen ? out : null;
}

function euroBaseParams(cfg, grid) {
  const { latQ, lonQ } = euroPointParams(grid);
  const params = new URLSearchParams({
    latitude: latQ.join(","),
    longitude: lonQ.join(","),
    hourly: cfg.hourly,
    forecast_days: String(EURO_DAYS),
    timeformat: "unixtime",
    timezone: "UTC",
  });
  if (cfg.unit === "mph") params.set("wind_speed_unit", "mph");
  return params;
}

function euroTimes(hourly) {
  const steps = Math.floor(hourly.time.length / EURO_HOURS);
  return Array.from({ length: steps }, (_, s) => hourly.time[s * EURO_HOURS]);
}

/* GET con un reintento silencioso si el servicio devuelve 429
   (límite por minuto de Open-Meteo) */
function euroSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal)
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          const e = new Error("abort");
          e.name = "AbortError";
          reject(e);
        },
        { once: true }
      );
  });
}

async function euroFetchJson(url, signal) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal });
    if (res.status === 429) {
      if (attempt === 0) {
        await euroSleep(8000, signal);
        continue;
      }
      const err = new Error("HTTP 429");
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

/* Probabilidad: el ensemble de ECMWF (EPS; AIFS-ENS cuando es la variante) */
async function fetchEuroProb(modelKey, varKey, grid, signal) {
  const cfg = EURO_VARS[varKey];
  const model = EURO_MODELS_CFG[modelKey];
  const params = euroBaseParams(cfg, grid);
  params.set("models", model.ens);
  const raw = await euroFetchJson(
    `https://ensemble-api.open-meteo.com/v1/ensemble?${params}`,
    signal
  );
  const list = Array.isArray(raw) ? raw : [raw];
  const times = euroTimes(list[0].hourly);
  let members = 0;
  const values = list.map((loc) => {
    const keys = Object.keys(loc.hourly).filter(
      (k) => k === cfg.hourly || k.startsWith(cfg.hourly + "_member")
    );
    members = Math.max(members, keys.length);
    return times.map((_, s) => {
      let hits = 0;
      let total = 0;
      for (const k of keys) {
        const v = euroWindow(loc.hourly[k], cfg, s);
        if (v == null) continue;
        total++;
        if (v > cfg.threshold) hits++;
      }
      return total ? Math.round((hits / total) * 100) : null;
    });
  });
  return { grid, times, values, members, mode: "prob", variable: varKey, model: modelKey, at: Date.now() };
}

/* Determinista: UNA sola petición por centro y rejilla, con las tres
   variables más la dirección del viento. De ese paquete salen los campos
   de viento, ráfagas y lluvia Y las partículas animadas: cuatro usos con
   una única llamada, para cuidar la cuota del servicio. */
async function fetchDetBundle(modelKey, grid, signal) {
  const model = EURO_MODELS_CFG[modelKey];
  const { latQ, lonQ } = euroPointParams(grid);
  const params = new URLSearchParams({
    latitude: latQ.join(","),
    longitude: lonQ.join(","),
    hourly: "wind_speed_10m,wind_gusts_10m,precipitation,wind_direction_10m,temperature_2m",
    forecast_days: String(EURO_DAYS),
    timeformat: "unixtime",
    timezone: "UTC",
    wind_speed_unit: "mph",
    temperature_unit: "celsius" /* la capa de temperatura va en °C */,
    models: model.det,
  });
  const raw = await euroFetchJson(
    `https://api.open-meteo.com/v1/forecast?${params}`,
    signal
  );
  const list = Array.isArray(raw) ? raw : [raw];
  const times = euroTimes(list[0].hourly);
  const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const hourly = list.map((loc) => ({
    speed: (loc.hourly.wind_speed_10m || []).map(round1),
    gusts: (loc.hourly.wind_gusts_10m || []).map(round1),
    precip: (loc.hourly.precipitation || []).map(round1),
    temp: (loc.hourly.temperature_2m || []).map(round1),
    dir: (loc.hourly.wind_direction_10m || []).map((v) =>
      v == null ? null : Math.round(v)
    ),
  }));
  return { kind: "bundle", grid, times, hourly, model: modelKey, at: Date.now() };
}

const BUNDLE_VAR = { wind: "speed", gusts: "gusts", rain: "precip", temp: "temp" };

/* campo determinista de una variable, calculado del paquete */
function deriveDetData(bundle, varKey) {
  if (!bundle.derived) bundle.derived = {};
  if (bundle.derived[varKey]) return bundle.derived[varKey];
  const cfg = EURO_VARS[varKey];
  const srcKey = BUNDLE_VAR[varKey];
  const values = bundle.hourly.map((pt) =>
    bundle.times.map((_, s) => {
      const v = euroWindow(pt[srcKey], cfg, s);
      return v == null ? null : Math.round(v * 10) / 10;
    })
  );
  const data = {
    grid: bundle.grid,
    times: bundle.times,
    values,
    members: 1,
    mode: "det",
    variable: varKey,
    model: bundle.model,
    at: bundle.at,
  };
  bundle.derived[varKey] = data;
  return data;
}

/* vectores u/v para las partículas, calculados del mismo paquete */
function deriveWindUV(bundle) {
  if (bundle.windUV) return bundle.windUV;
  const steps = bundle.times.length;
  const u = [];
  const v = [];
  for (const pt of bundle.hourly) {
    const su = new Array(steps);
    const sv = new Array(steps);
    const n = pt.speed.length;
    for (let s = 0; s < steps; s++) {
      const hh = Math.min(s * EURO_HOURS + 3, Math.max(0, n - 1));
      const spd = pt.speed[hh];
      const dir = pt.dir[hh];
      if (spd == null || dir == null) {
        su[s] = 0;
        sv[s] = 0;
        continue;
      }
      /* convención meteorológica: la dirección es DE DONDE viene */
      const rad = (dir * Math.PI) / 180;
      su[s] = -spd * Math.sin(rad);
      sv[s] = -spd * Math.cos(rad);
    }
    u.push(su);
    v.push(sv);
  }
  bundle.windUV = { grid: bundle.grid, u, v, steps, model: bundle.model, at: bundle.at };
  return bundle.windUV;
}

/* Calidad del aire: índice AQI del CAMS global (Copernicus), 0.4° */
async function fetchEuroAir(grid, signal) {
  const cfg = EURO_VARS.air;
  const params = euroBaseParams(cfg, grid);
  const raw = await euroFetchJson(
    `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`,
    signal
  );
  const list = Array.isArray(raw) ? raw : [raw];
  const times = euroTimes(list[0].hourly);
  const values = list.map((loc) =>
    times.map((_, s) => {
      const v = euroWindow(loc.hourly[cfg.hourly], cfg, s);
      return v == null ? null : Math.round(v);
    })
  );
  return { grid, times, values, members: 1, mode: "det", variable: "air", model: "cams", at: Date.now() };
}

/* color interpolado sobre la rampa */
function euroColor(v, stops) {
  if (v == null) return [0, 0, 0, 0];
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i - 1];
    const [v2, c2] = stops[i];
    if (v <= v2) {
      const t = (v - v1) / (v2 - v1);
      return c1.map((a, j) => Math.round(a + (c2[j] - a) * t));
    }
  }
  return stops[stops.length - 1][1];
}

function euroDefaultStep(times) {
  const now = Date.now() / 1000;
  const i = times.findIndex((t) => t + EURO_HOURS * 3600 > now);
  return i < 0 ? 0 : i;
}

function fmtHour12(d) {
  const h = d.getHours();
  const suffix = h >= 12 ? "p. m." : "a. m.";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

function euroStepLabel(t) {
  const from = new Date(t * 1000);
  const to = new Date((t + EURO_HOURS * 3600) * 1000);
  const day = from.toLocaleDateString(tLocale(), { weekday: "short", day: "numeric" });
  return `${day} · ${fmtHour12(from)} – ${fmtHour12(to)}`;
}

function euroLegend(stops, ticks, unit) {
  const min = stops[0][0];
  const max = stops[stops.length - 1][0];
  const pct = (v) => (((v - min) / (max - min)) * 100).toFixed(1);
  $("euro-legend-bar").style.background = `linear-gradient(to right, ${stops
    .map(
      ([v, c]) =>
        `rgba(${c[0]},${c[1]},${c[2]},${(Math.max(c[3], 36) / 255).toFixed(2)}) ${pct(v)}%`
    )
    .join(",")})`;
  /* los rótulos extremos se acotan para no salirse del panel */
  const tickPos = (v) => Math.max(4, Math.min(94, Number(pct(v))));
  $("euro-legend-ticks").innerHTML = ticks
    .map(
      (v, i) =>
        `<span style="left:${tickPos(v)}%">${v}${i === ticks.length - 1 ? ` ${unit}` : ""}</span>`
    )
    .join("");
}

/* capas de imagen georreferenciada (satélite, lluvia, radar) */
function imageLayerRemove(srcId, layerId) {
  if (!map || !map.getLayer) return;
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(srcId)) map.removeSource(srcId);
}

function imageLayerSet(srcId, layerId, url, bbox, opacity) {
  if (ownFrameFailed.has(url)) return; /* podado por el robot: no insistir */
  const coords = [
    [bbox.west, bbox.north],
    [bbox.east, bbox.north],
    [bbox.east, bbox.south],
    [bbox.west, bbox.south],
  ];
  const src2 = map.getSource && map.getSource(srcId);
  if (src2 && src2.updateImage) {
    src2.updateImage({ url, coordinates: coords });
  } else {
    imageLayerRemove(srcId, layerId);
    map.addSource(srcId, { type: "image", url, coordinates: coords });
    map.addLayer(
      {
        id: layerId,
        type: "raster",
        source: srcId,
        paint: { "raster-opacity": opacity, "raster-fade-duration": 0 },
      },
      weatherAnchor
    );
  }
}

const SAT_SOURCE = "sat-img";
const SAT_LAYER = "sat-img-layer";

function satOverlayRemove() {
  imageLayerRemove("world-ir", "world-ir-layer");
  imageLayerRemove(SAT_SOURCE, SAT_LAYER);
}

/* mundo (horario) primero para que quede DEBAJO de la región (10 min) */
function satShow(frame) {
  if (worldSat) {
    const w = nearestFrame(worldSat.ir, frame.time);
    if (w) imageLayerSet("world-ir", "world-ir-layer", w.url, worldSat.bbox, 0.88);
  }
  if (goesData) imageLayerSet(SAT_SOURCE, SAT_LAYER, frame.url, goesData.bbox, 0.88);
}

/* radar propio: lluvia satelital debajo + MRMS real encima */
function radarOwnRemove() {
  imageLayerRemove("world-rain", "world-rain-layer");
  imageLayerRemove("rain-img", "rain-img-layer");
  imageLayerRemove("mrms-conus", "mrms-conus-layer");
  imageLayerRemove("mrms-carib", "mrms-carib-layer");
}

function mrmsNearest(time) {
  if (!radarOwn || !radarOwn.mrms) return null;
  let best = null;
  let bd = Infinity;
  for (const f of radarOwn.mrms.frames) {
    const d = Math.abs(f.time - time);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return bd <= 1800 ? best : null; /* hasta 30 min de desfase */
}

function radarOwnShow(frame) {
  if (worldSat && worldSat.rain.length) {
    const w = nearestFrame(worldSat.rain, frame.time);
    if (w) imageLayerSet("world-rain", "world-rain-layer", w.url, worldSat.bbox, 0.7);
  }
  imageLayerSet("rain-img", "rain-img-layer", frame.url, radarOwn.rain.bbox, 0.7);
  const m = mrmsNearest(frame.time);
  for (const dom of ["conus", "carib"]) {
    const url = m && m.files[dom];
    const bbox = radarOwn.mrms && radarOwn.mrms.bboxes[dom];
    if (url && bbox)
      imageLayerSet(`mrms-${dom}`, `mrms-${dom}-layer`, url, bbox, 0.85);
    else imageLayerRemove(`mrms-${dom}`, `mrms-${dom}-layer`);
  }
}

const EURO_SOURCE = "euro-field";
const EURO_LAYER = "euro-field-layer";

function euroOverlayRemove() {
  if (!map || !map.getLayer) return;
  if (map.getLayer(EURO_LAYER)) map.removeLayer(EURO_LAYER);
  if (map.getSource(EURO_SOURCE)) map.removeSource(EURO_SOURCE);
  euro.overlay = null;
  isoHide();
}

/* el modelo va DEBAJO de radar/satélite/nubes: acompaña, no tapa */
function euroBeforeId() {
  const above = [
    "world-rain-layer",
    "rain-img-layer",
    "mrms-conus-layer",
    "mrms-carib-layer",
    "world-ir-layer",
    "sat-img-layer",
    "wx-tiles-layer",
  ];
  for (const id of above) if (map.getLayer && map.getLayer(id)) return id;
  return weatherAnchor;
}

function euroOverlaySet(url, west, south, east, north) {
  const coords = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
  const src2 = map.getSource && map.getSource(EURO_SOURCE);
  if (src2 && src2.updateImage) {
    src2.updateImage({ url, coordinates: coords });
  } else {
    euroOverlayRemove();
    map.addSource(EURO_SOURCE, { type: "image", url, coordinates: coords });
    map.addLayer(
      {
        id: EURO_LAYER,
        type: "raster",
        source: EURO_SOURCE,
        paint: { "raster-opacity": 0.72, "raster-fade-duration": 0 },
      },
      euroBeforeId()
    );
  }
  euro.overlay = true;
}

/* ═══ isobaras del MSLP (GeoJSON por período, generado por el robot) ═══
   Solo existen para el producto mundial del IFS: se pintan encima del
   campo de color y debajo de los rótulos, con su valor en hPa. */
const iso = { cache: new Map(), url: null };

function isoLayersEnsure() {
  if (!map || !map.getSource || map.getSource("iso-src")) return;
  try {
    map.addSource("iso-src", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    let font = ["Noto Sans Regular"];
    try {
      const ls = (map.getStyle() && map.getStyle().layers) || [];
      const sSym = ls.find(
        (l) =>
          l.type === "symbol" &&
          l.layout &&
          Array.isArray(l.layout["text-font"]) &&
          l.layout["text-font"].length
      );
      if (sSym) font = sSym.layout["text-font"];
    } catch (_) {}
    map.addLayer(
      {
        id: "iso-lines",
        type: "line",
        source: "iso-src",
        paint: { "line-color": "rgba(235,240,255,0.55)", "line-width": 1 },
      },
      labelsAnchor
    );
    map.addLayer(
      {
        id: "iso-labels",
        type: "symbol",
        source: "iso-src",
        layout: {
          "symbol-placement": "line",
          "text-field": ["to-string", ["get", "p"]],
          "text-size": 10,
          "text-font": font,
          "symbol-spacing": 320,
        },
        paint: {
          "text-color": "#cfd8ef",
          "text-halo-color": "#0b1017",
          "text-halo-width": 1.4,
        },
      },
      labelsAnchor
    );
  } catch (_) {}
}

function isoHide() {
  const src = map && map.getSource && map.getSource("iso-src");
  if (src && src.setData) src.setData({ type: "FeatureCollection", features: [] });
  iso.url = null;
}

async function isoApply(step) {
  if (!map) return;
  if (settings.isobars !== true) return isoHide();
  const m = mapaSrc.data;
  const files = m && m.isobars;
  if (!files || !files.length) return isoHide();
  let idx = Math.max(0, Math.min(step ?? 0, files.length - 1));
  if (!files[idx]) {
    for (let k = 1; k < files.length; k++) {
      if (files[idx - k]) {
        idx -= k;
        break;
      }
      if (files[idx + k]) {
        idx += k;
        break;
      }
    }
  }
  if (!files[idx]) return isoHide();
  const url = `${STATIC_BASE}/ecmwf/${files[idx]}`;
  if (iso.url === url) return;
  iso.url = url;
  let gj = iso.cache.get(url);
  if (!gj) {
    try {
      const res = await fetch(url);
      if (!res.ok) return isoHide();
      gj = await res.json();
      iso.cache.set(url, gj);
      if (iso.cache.size > 24) iso.cache.delete(iso.cache.keys().next().value);
    } catch (_) {
      return isoHide();
    }
  }
  if (iso.url !== url) return; /* el usuario ya movió el período */
  isoLayersEnsure();
  const src = map.getSource && map.getSource("iso-src");
  if (src && src.setData) src.setData(gj);
}

/* proyección Mercator: latitud → y (y su inversa) */
function mercY(lat) {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}
function mercLat(y) {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}

/* Pinta el paso actual. Leaflet estira la imagen linealmente en el espacio
   Mercator del mapa, así que cada fila de píxeles se remuestrea según la
   latitud que le corresponde en esa proyección (si no, el campo se corre
   hacia el ecuador en vistas amplias). Interpolación bilineal de VALORES,
   coloreada después con la rampa. */
/* pinta un período del mapa mundial pre-renderizado (imágenes del robot) */
function euroRenderMapa(files, mode) {
  const m = mapaSrc.data;
  const cfg = EURO_VARS[euro.variable];
  const prob = mode === "prob";
  const stops = prob ? EURO_PROB_STOPS : cfg.detStops;

  if (euro.step == null) euro.step = euroDefaultStep(m.times);
  euro.step = Math.max(0, Math.min(euro.step, m.times.length - 1));
  /* si el período exacto no tiene imagen (hueco), usa la más cercana */
  let idx = euro.step;
  if (!files[idx]) {
    for (let k = 1; k < files.length; k++) {
      if (files[idx - k]) {
        idx -= k;
        break;
      }
      if (files[idx + k]) {
        idx += k;
        break;
      }
    }
  }
  if (!files[idx]) return;
  const b = m.bbox;
  euroOverlaySet(`${STATIC_BASE}/ecmwf/${files[idx]}`, b.west, b.south, b.east, b.north);
  isoApply(euro.step);
  $("euro-thr").hidden = true;
  $("euro-loading").hidden = true;

  $("euro-title").textContent = prob ? cfg.probTitle : cfg.detTitle;
  $("euro-sub").textContent = prob
    ? `EPS de ECMWF · ${m.members || 51} escenarios · mundial`
    : "IFS de ECMWF · determinista (0.25°) · mundial";
  modeSegSync();
  const slider = $("euro-slider");
  slider.max = String(m.times.length - 1);
  slider.value = String(euro.step);
  $("euro-step-label").textContent = euroStepLabel(m.times[euro.step]);
  euroLegend(stops, prob ? EURO_PROB_TICKS : cfg.detTicks, prob ? "%" : cfg.unit);
  $("euro-note").textContent =
    (prob
      ? `Porcentaje de los ${m.members || 51} escenarios del EPS de ECMWF que superan el umbral en cada período de 6 h.`
      : `IFS de ECMWF (0.25°): ${
          cfg.agg === "sum" ? "total acumulado" : "valor máximo"
        } de cada período de 6 h.`) +
    " Cobertura mundial. Datos abiertos oficiales procesados por Fenómenos cada 6 h.";
  windEnsure();
}

/* ═══ Prob. 24 h: productos DIARIOS del ENS (prob24.json del robot) ═══
   % de miembros que superan cada umbral, por día del pronóstico:
   lluvia acumulada 24 h (mm), viento sostenido (kt) y Tmáx (°C). Rayos
   NO: el ENS abierto no publica densidad de rayos (sondeo 30411673974)
   y no se sustituye con un proxy. */
const P24_VAR = { rain: "rain", wind: "wind", temp: "tmax" };
const P24_TITLES = {
  rain: (u) => `Probabilidad de lluvia ≥ ${u} mm en 24 h`,
  wind: (u) => `Probabilidad de viento sostenido ≥ ${u} kt en el día`,
  tmax: (u) => `Probabilidad de Tmáx > ${u} °C`,
};
const p24Src = { data: null, checked: false, at: 0 };
if (!euro.thr) euro.thr = {};

async function p24Meta() {
  const now = Date.now();
  if (p24Src.data || (p24Src.checked && now - p24Src.at < 10 * 60 * 1000))
    return p24Src.data;
  p24Src.checked = true;
  p24Src.at = now;
  try {
    const res = await fetch(`${STATIC_BASE}/ecmwf/prob24.json`, { cache: "no-cache" });
    if (res.ok) {
      const m = await res.json();
      if (
        m &&
        m.generated &&
        Date.now() / 1000 - m.generated < 12 * 3600 &&
        m.vars &&
        m.days &&
        m.bbox
      )
        p24Src.data = m;
    }
  } catch (_) {}
  return p24Src.data;
}

function p24DayLabel(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString(tLocale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/* qué modos aplican a la variable activa: prob (6 h) solo con ensemble
   horario; p24 solo para lluvia/viento/temp del IFS; el aire no tiene
   modos. Si el modo activo deja de ser válido, cae al primero válido. */
function modeSegSync() {
  const va = euro.variable;
  const probBtn = document.querySelector('#euro-mode [data-value="prob"]');
  const p24Btn = document.querySelector('#euro-mode [data-value="p24"]');
  const probOk = !euroDetOnly(va);
  const p24Ok = !!P24_VAR[va] && euro.model === "ecmwf";
  if (probBtn) probBtn.style.display = probOk ? "" : "none";
  if (p24Btn) p24Btn.style.display = p24Ok ? "" : "none";
  $("euro-mode").style.display = va === "air" ? "none" : "";
  if ((euro.mode === "prob" && !probOk) || (euro.mode === "p24" && !p24Ok)) {
    euro.mode = probOk ? "prob" : "det";
    setSegValue("euro-mode", euro.mode);
  }
  if (euro.mode !== "p24") $("euro-thr").hidden = true;
}

function euroRenderP24() {
  const m = p24Src.data;
  const key = P24_VAR[euro.variable];
  const v = m && key && m.vars[key];
  const thrSeg = $("euro-thr");
  if (!v) {
    euroOverlayRemove();
    thrSeg.hidden = true;
    $("euro-title").textContent = "—";
    $("euro-note").textContent =
      "Este producto diario no está disponible para esta variable (solo lluvia, viento y temperatura, del ENS del IFS).";
    $("euro-loading").hidden = true;
    return;
  }
  /* umbral activo válido para la variable */
  if (!v.umbrales.includes(euro.thr[key])) euro.thr[key] = v.umbrales[0];
  const thr = euro.thr[key];
  thrSeg.hidden = false;
  thrSeg.innerHTML = v.umbrales
    .map(
      (u) =>
        `<button class="seg__btn${u === thr ? " is-active" : ""}" data-thr="${u}">≥ ${u} ${v.unidad.split("/")[0]}</button>`
    )
    .join("");
  /* día activo */
  const nDays = m.days.length;
  if (euro.step == null) euro.step = 0;
  euro.step = Math.max(0, Math.min(euro.step, nDays - 1));
  const files = v.img[String(thr)] || [];
  let idx = euro.step;
  if (!files[idx]) {
    for (let k = 1; k < nDays; k++) {
      if (files[idx - k]) { idx -= k; break; }
      if (files[idx + k]) { idx += k; break; }
    }
  }
  if (files[idx]) {
    const b = m.bbox;
    euroOverlaySet(`${STATIC_BASE}/ecmwf/${files[idx]}`, b.west, b.south, b.east, b.north);
  } else {
    euroOverlayRemove();
  }
  isoHide(); /* las isobaras viven en la línea de tiempo de 6 h, no en días */
  $("euro-loading").hidden = true;
  $("euro-title").textContent = P24_TITLES[key](thr);
  $("euro-sub").textContent = `EPS de ECMWF · ${m.members || "≥30"} miembros · diario · mundial`;
  modeSegSync();
  const slider = $("euro-slider");
  slider.max = String(nDays - 1);
  slider.value = String(euro.step);
  $("euro-step-label").textContent = p24DayLabel(m.days[euro.step]);
  euroLegend(EURO_PROB_STOPS, EURO_PROB_TICKS, "%");
  $("euro-note").textContent =
    `Porcentaje de los ${m.members || "≥30"} miembros del ENS que superan el umbral ese día (UTC). ` +
    (v.nota ? v.nota + ". " : "") +
    "Datos abiertos de ECMWF procesados por Fenómenos cada 6 h.";
}

function euroRender() {
  if (!map) return;
  if (euro.mode === "p24" && euro.model === "ecmwf" && euro.variable !== "air") {
    if (p24Src.data) {
      euroRenderP24();
      return;
    }
    /* aún sin meta: se pide y se repinta al llegar */
    p24Meta().then((d) => {
      if (d && euro.mode === "p24") euroRenderP24();
      else if (euro.mode === "p24") {
        euroOverlayRemove();
        $("euro-title").textContent = "—";
        $("euro-note").textContent =
          "El producto diario del ENS aún no está publicado por el robot (o su pasada tiene más de 12 h). Vuelve en unos minutos.";
        $("euro-loading").hidden = true;
      }
    });
    return;
  }
  /* el mapa mundial en imágenes tiene prioridad (mejor calidad y global);
     SOLO existe para el IFS — con la variante AIFS o la capa de aire se
     sigue el camino clásico (rejilla del robot / API) */
  if (euro.variable !== "air" && euro.model === "ecmwf") {
    const modeSel = euroDetOnly(euro.variable) ? "det" : euro.mode;
    const files = mapaFrames(modeSel, euro.variable);
    if (files) {
      euroRenderMapa(files, modeSel);
      return;
    }
  }
  const d = euro.data;
  isoHide(); /* las isobaras solo existen para el producto mundial del IFS */
  if (!d) return;
  /* siempre según los datos mostrados (si una carga falló, la selección
     de los controles puede ir por delante de lo que hay en pantalla) */
  const cfg = EURO_VARS[d.variable];
  const prob = d.mode === "prob";
  const stops = prob ? EURO_PROB_STOPS : cfg.detStops;

  if (euro.step == null) euro.step = euroDefaultStep(d.times);
  euro.step = Math.max(0, Math.min(euro.step, d.times.length - 1));

  const rows = d.grid.lats.length;
  const cols = d.grid.lons.length;
  const half = d.grid.sp / 2;
  const step = euro.step;
  const val = (r, c) => {
    const point = d.values[r * cols + c];
    return point ? point[step] : null;
  };

  const latTop = Math.min(85, d.grid.lats[0] + half);
  const latBot = Math.max(-85, d.grid.lats[rows - 1] - half);
  const yTop = mercY(latTop);
  const yBot = mercY(latBot);

  /* con la rejilla nativa de 0.25° el lienzo sube hasta 1600 px: los
     campos se ven nítidos y específicos, no manchas gigantes */
  const W = Math.min(cols * 12, 1600);
  const H = Math.min(Math.max(rows * 12, 64), 1600);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const cctx = cv.getContext("2d");
  const img = cctx.createImageData(W, H);

  for (let oy = 0; oy < H; oy++) {
    /* fila de píxeles → latitud real en Mercator → fila fraccional */
    const lat = mercLat(yTop + ((yBot - yTop) * (oy + 0.5)) / H);
    let g = (d.grid.lats[0] - lat) / d.grid.sp;
    g = Math.max(0, Math.min(rows - 1, g));
    const r0 = Math.floor(g);
    const r1 = Math.min(rows - 1, r0 + 1);
    const tr = g - r0;
    for (let ox = 0; ox < W; ox++) {
      let gx = ((ox + 0.5) / W) * cols - 0.5;
      gx = Math.max(0, Math.min(cols - 1, gx));
      const c0 = Math.floor(gx);
      const c1 = Math.min(cols - 1, c0 + 1);
      const tc = gx - c0;
      /* media ponderada de los 4 vecinos, ignorando huecos */
      let sum = 0;
      let wsum = 0;
      const acc = (v, w) => {
        if (v != null && w > 0) {
          sum += v * w;
          wsum += w;
        }
      };
      acc(val(r0, c0), (1 - tr) * (1 - tc));
      acc(val(r0, c1), (1 - tr) * tc);
      acc(val(r1, c0), tr * (1 - tc));
      acc(val(r1, c1), tr * tc);
      const [R, G, B, A] = euroColor(wsum > 0 ? sum / wsum : null, stops);
      const o = (oy * W + ox) * 4;
      img.data[o] = R;
      img.data[o + 1] = G;
      img.data[o + 2] = B;
      img.data[o + 3] = A;
    }
  }
  cctx.putImageData(img, 0, 0);

  euroOverlaySet(
    cv.toDataURL("image/png"),
    d.grid.lons[0] - half,
    latBot,
    d.grid.lons[cols - 1] + half,
    latTop
  );

  /* controles */
  const isAir = euro.variable === "air";
  const modelCfg = EURO_MODELS_CFG[d.model] || EURO_MODELS_CFG[euro.model];
  $("euro-title").textContent = prob ? cfg.probTitle : cfg.detTitle;
  $("euro-sub").textContent = isAir
    ? "CAMS de Copernicus · global (0.4°)"
    : prob
      ? `${modelCfg.ensName} · ${d.members || modelCfg.fallbackMembers} escenarios`
      : modelCfg.detLabel;
  /* aire y temperatura no tienen ensemble */
  modeSegSync();
  $("euro-thr").hidden = true;
  const slider = $("euro-slider");
  slider.max = String(d.times.length - 1);
  slider.value = String(euro.step);
  $("euro-step-label").textContent = euroStepLabel(d.times[euro.step]);
  euroLegend(stops, prob ? EURO_PROB_TICKS : cfg.detTicks, prob ? "%" : cfg.unit);
  const srcNote = d.staticKey
    ? " Datos abiertos oficiales del centro, procesados por Fenómenos cada 6 h."
    : "";
  $("euro-note").textContent = (isAir
    ? `Índice de calidad del aire (AQI de EE. UU.) del CAMS de Copernicus: máximo de cada período de 6 h. 0–50 bueno · 51–100 moderado · 101–150 dañino para grupos sensibles · 151+ dañino. Rejilla de ${d.grid.sp}°.`
    : prob
      ? `Porcentaje de los ${d.members || modelCfg.fallbackMembers} escenarios del ${modelCfg.ensName} que superan el umbral en cada período de 6 h. Rejilla de ${d.grid.sp}°.`
      : `${modelCfg.detLabel}: ${
          cfg.agg === "sum" ? "total acumulado" : "valor máximo"
        } de cada período de 6 h. Rejilla de ${d.grid.sp}°.`) + srcNote;
  windEnsure();
}

/* lectura del punto tocado para el popup del mapa */
function euroReadout(lat, lng) {
  const d = euro.data;
  if (!euro.on || !d || euro.step == null) return "";
  const rows = d.grid.lats.length;
  const cols = d.grid.lons.length;
  const r = Math.round((d.grid.lats[0] - lat) / d.grid.sp);
  const c = Math.round((lng - d.grid.lons[0]) / d.grid.sp);
  if (r < 0 || c < 0 || r >= rows || c >= cols) return "";
  const point = d.values[r * cols + c];
  const v = point ? point[euro.step] : null;
  if (v == null) return "";
  /* etiquetas según los datos en pantalla, no según la selección */
  const cfg = EURO_VARS[d.variable];
  const prob = d.mode === "prob";
  const label = prob ? cfg.probShort : cfg.detShort;
  const value = prob ? `${v} %` : `${v} ${cfg.unit}`;
  return `<br>${label}: <strong>${value}</strong> · ${euroStepLabel(d.times[euro.step])}`;
}

/* ── Fuente propia (robot de GitHub Actions) ─────────────────────────────
   Si el repositorio publica data/modelos/ (ver scripts/build_model_data.py),
   los campos del modelo se leen de archivos estáticos del propio sitio:
   cero llamadas a APIs externas por usuario, a cualquier escala. Si no
   existen o están viejos, se usa Open-Meteo como respaldo automático. */

/* los modelos viven en el repo público de datos (su historia se aplasta a
   un commit, así el peso de cada corrida no acumula) */
const STATIC_BASE = `${DATA_REPO}/modelos`;
const staticSrc = { meta: null, checked: false, files: new Map() };

async function staticMeta() {
  if (staticSrc.checked) return staticSrc.meta;
  staticSrc.checked = true;
  try {
    const res = await fetch(`${STATIC_BASE}/meta.json`, { cache: "no-cache" });
    if (res.ok) {
      const m = await res.json();
      /* datos con más de 12 h se consideran vencidos */
      if (m && m.generated && Date.now() / 1000 - m.generated < 12 * 3600)
        staticSrc.meta = m;
    }
  } catch (_) {}
  return staticSrc.meta;
}

async function staticFile(center, name) {
  const key = `${center}/${name}`;
  if (staticSrc.files.has(key)) return staticSrc.files.get(key);
  const res = await fetch(`${STATIC_BASE}/${key}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  staticSrc.files.set(key, data);
  return data;
}

/* ── mapa mundial: el robot pinta el ECMWF global como imágenes webp en
   Mercator (mapa.json): cobertura de todo el planeta y nitidez sin que el
   teléfono calcule nada. Si no está disponible, la app cae al camino
   clásico (rejilla regional + lienzo). ── */
const mapaSrc = { data: null, checked: false, at: 0 };

async function mapaMeta() {
  /* si aún no está publicado, se reintenta cada 10 min: una pestaña
     abierta engancha el mapa mundial sin recargar */
  const now = Date.now();
  if (mapaSrc.data || (mapaSrc.checked && now - mapaSrc.at < 10 * 60 * 1000))
    return mapaSrc.data;
  mapaSrc.checked = true;
  mapaSrc.at = now;
  try {
    const res = await fetch(`${STATIC_BASE}/ecmwf/mapa.json`, { cache: "no-cache" });
    if (res.ok) {
      const m = await res.json();
      if (
        m &&
        m.generated &&
        Date.now() / 1000 - m.generated < 12 * 3600 &&
        m.bbox &&
        m.times
      )
        mapaSrc.data = m;
    }
  } catch (_) {}
  return mapaSrc.data;
}

function mapaFrames(mode, variable) {
  const m = mapaSrc.data;
  const set = m && (mode === "prob" ? m.prob : m.det);
  const files = set && set[variable];
  return files && files.some(Boolean) ? files : null;
}

/* intenta servir la vista actual desde la fuente propia; true si lo hizo */
async function staticUse(mode) {
  const meta = await staticMeta();
  const st = meta && meta.centers && meta.centers[euro.model];
  if (!st || !(mode === "det" ? st.det : st.prob)) return false;
  try {
    const file = await staticFile(euro.model, mode);
    const values = file[euro.variable];
    if (!values || !file.grid || !file.times) return false;
    const staticKey = `${euro.model}|${euro.variable}|${mode}`;
    if (euro.data && euro.data.staticKey === staticKey) return true;
    euro.seq++; /* invalida peticiones en vuelo */
    if (euro.abort) euro.abort.abort();
    $("euro-loading").hidden = true;
    euro.data = {
      grid: file.grid,
      times: file.times,
      values,
      members: file.members || 1,
      mode,
      variable: euro.variable,
      model: euro.model,
      at: (file.generated || 0) * 1000,
      staticKey,
    };
    euroRender();
    return true;
  } catch (_) {
    return false;
  }
}

let euroMoveTimer = null;
function euroRefreshSoon() {
  clearTimeout(euroMoveTimer);
  euroMoveTimer = setTimeout(() => euroRefresh(), 800);
}

const EURO_CACHE_TTL = 60 * 60 * 1000; /* los modelos se actualizan cada ~6 h */
const EURO_CACHE_LS = "fdc-euro-cache-v1";
const EURO_COOLDOWN_LS = "fdc-euro-cooldown";

/* la caché de campos sobrevive a la recarga de la página: recargar la app
   no vuelve a gastar cuota del servicio */
function euroCacheSet(key, entry) {
  euro.cache.set(key, entry);
  if (euro.cache.size > 24) euro.cache.delete(euro.cache.keys().next().value);
  try {
    const out = [];
    let size = 0;
    for (const [k, e] of [...euro.cache.entries()].reverse()) {
      if (!e || !e.data || Date.now() - e.at > EURO_CACHE_TTL) continue;
      const d = e.data;
      const slim =
        d.kind === "bundle" ? { ...d, derived: undefined, windUV: undefined } : d;
      const s = JSON.stringify([k, { data: slim, at: e.at }]);
      if (s.length > 500000 || size + s.length > 1500000) continue;
      size += s.length;
      out.push(s);
    }
    localStorage.setItem(EURO_CACHE_LS, `[${out.join(",")}]`);
  } catch (_) {
    /* almacenamiento lleno o bloqueado: la caché en memoria basta */
  }
}

function euroCacheLoad() {
  try {
    const raw = localStorage.getItem(EURO_CACHE_LS);
    if (raw)
      for (const [k, e] of JSON.parse(raw))
        if (e && e.data && Date.now() - e.at < EURO_CACHE_TTL)
          euro.cache.set(k, e);
    euro.cooldownUntil = Number(localStorage.getItem(EURO_COOLDOWN_LS)) || 0;
  } catch (_) {}
}
euroCacheLoad();

async function euroRefresh() {
  if (!euro.on || !map) return;
  modeSegSync(); /* si la variable nueva no admite el modo activo, cae aquí */
  /* Prob. 24 h: producto propio del robot, sin llamadas a la API */
  if (euro.mode === "p24") {
    if (euro.model !== "ecmwf" || euro.variable === "air") {
      euroOverlayRemove();
      $("euro-thr").hidden = true;
      $("euro-title").textContent = "—";
      $("euro-note").textContent =
        "Las probabilidades diarias salen del ENS del IFS: cambia a la variante IFS HRES (o a otra variable) para verlas.";
      $("euro-loading").hidden = true;
      return;
    }
    await p24Meta();
    euroRender();
    return;
  }
  /* aire y temperatura no tienen ensemble: siempre deterministas */
  const isAir = euro.variable === "air";
  const mode = euroDetOnly(euro.variable) ? "det" : euro.mode;

  /* mapa mundial en imágenes (solo IFS): cero API y cero cálculo en el
     cliente; la rejilla regional se carga aparte para el popup de valores */
  if (!isAir && euro.model === "ecmwf") {
    await mapaMeta();
    if (mapaFrames(mode, euro.variable)) {
      staticUse(mode);
      euroRender();
      return;
    }
  }

  /* Probabilidad con la variante AIFS: su ensemble está congelado en la
     fuente abierta (sondeo 2026-07-22) — se declara, no se pinta */
  if (!isAir && mode === "prob" && euro.model === "aifs") {
    if (!(await ensFresh("ecmwf_aifs025", true))) {
      euroOverlayRemove();
      $("euro-loading").hidden = true;
      $("euro-note").textContent =
        "El AIFS-ENS no se está actualizando en los datos abiertos: sin mapa de probabilidades para la variante IA. Cambia a IFS HRES o al modo Determinista.";
      return;
    }
  }

  /* la fuente propia (datos procesados por el robot) tiene prioridad */
  if (!isAir && (await staticUse(mode))) return;
  /* la rejilla determinista es más fina: una sola pasada pesa poco.
     La del ensemble es más pequeña: decenas de miembros por punto
     pesan en la cuota del servicio. */
  const grid = mode === "det" ? euroGrid(16, 11) : euroGrid(11, 7);
  /* el respaldo por API solo sirve de cerca: a escala planetaria saldrían
     manchas gigantes sin detalle, no un modelo — mejor nada que feo */
  if (!isAir && grid.sp > 2) {
    euroOverlayRemove();
    $("euro-loading").hidden = true;
    $("euro-note").textContent =
      "El mapa mundial del modelo se está actualizando; acércate para ver el detalle de tu zona mientras tanto.";
    return;
  }
  /* el determinista se guarda como PAQUETE por centro+rejilla (sirve a las
     tres variables y a las partículas); el ensemble y el aire, por campo */
  const key = isAir
    ? `cams|air|${grid.key}`
    : mode === "det"
      ? `det|${euro.model}|${grid.key}`
      : `${euro.model}|${euro.variable}|prob|${grid.key}`;

  const cached = euro.cache.get(key);
  if (cached && Date.now() - cached.at < EURO_CACHE_TTL) {
    /* invalida cualquier petición en vuelo: si no, una respuesta tardía
       de otra variable/modo pisaría lo que se acaba de mostrar */
    euro.seq++;
    euro.inflightKey = null;
    if (euro.abort) euro.abort.abort();
    $("euro-loading").hidden = true;
    euro.data =
      cached.data.kind === "bundle"
        ? deriveDetData(cached.data, euro.variable)
        : cached.data;
    euroRender();
    return;
  }
  if (cached) euro.cache.delete(key);

  /* lo mostrado aún cubre esta vista → no gastamos cuota */
  if (euroCovered(grid)) return;

  /* esa misma petición ya va en camino */
  if (euro.inflightKey === key) return;

  /* respeta el enfriamiento tras un 429 y el intervalo mínimo por modo */
  const now = Date.now();
  const wait = Math.max(
    euro.cooldownUntil - now,
    euro.lastFetch[mode] + EURO_MIN_INTERVAL[mode] - now
  );
  if (wait > 0) {
    clearTimeout(euro.retryTimer);
    euro.retryTimer = setTimeout(() => euroRefresh(), wait + 200);
    if (!euro.data)
      $("euro-note").textContent = "Esperando al servicio del modelo…";
    return;
  }
  euro.lastFetch[mode] = now;

  const seq = ++euro.seq;
  if (euro.abort) euro.abort.abort();
  euro.abort = new AbortController();
  euro.inflightKey = key;
  $("euro-loading").hidden = false;
  try {
    const data = isAir
      ? await fetchEuroAir(grid, euro.abort.signal)
      : mode === "det"
        ? await fetchDetBundle(euro.model, grid, euro.abort.signal)
        : await fetchEuroProb(euro.model, euro.variable, grid, euro.abort.signal);
    euroCacheSet(key, { data, at: Date.now() });
    if (seq === euro.seq && euro.on) {
      euro.data = data.kind === "bundle" ? deriveDetData(data, euro.variable) : data;
      euroRender();
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      /* sustituida por otra petición: nada que hacer */
    } else if (err && err.rateLimited) {
      /* límite por minuto del servicio: enfriar y reintentar solo */
      euro.cooldownUntil = Date.now() + 120000;
      try {
        localStorage.setItem(EURO_COOLDOWN_LS, String(euro.cooldownUntil));
      } catch (_) {}
      clearTimeout(euro.retryTimer);
      euro.retryTimer = setTimeout(() => euroRefresh(), 121000);
      toast("El servicio del modelo está saturado; se reintenta en 2 minutos.", "error");
      $("euro-note").textContent =
        "Se alcanzó el límite del servicio del modelo. Se reintentará automáticamente en un par de minutos.";
    } else {
      toast("No se pudo cargar el modelo europeo.", "error");
      $("euro-note").textContent =
        "No se pudo cargar el modelo. Revisa tu conexión e intenta de nuevo.";
    }
  } finally {
    if (seq === euro.seq) {
      $("euro-loading").hidden = true;
      euro.inflightKey = null;
    }
  }
}

function euroSetActive(on, { silent = false } = {}) {
  euro.on = on && !!map;
  $("euro-panel").hidden = !euro.on;
  /* en pantallas pequeñas el panel arranca plegado para no tapar el mapa */
  if (euro.on && !euro.opened) {
    euro.opened = true;
    if (window.innerWidth < 768) $("euro-panel").classList.add("is-min");
  }
  if (!euro.on) {
    euroOverlayRemove();
    if (euro.abort) euro.abort.abort();
    clearTimeout(euro.retryTimer);
    clearTimeout(wind.retryTimer);
    euro.inflightKey = null;
    windStop();
    $("euro-loading").hidden = true;
    if (on && !map && !silent) toast("El mapa no está disponible.", "error");
    return;
  }
  euroRefresh();
}

/* ── Viento en movimiento ─────────────────────────────────────────────
   El truco visual de los grandes visores meteorológicos: cientos de
   partículas que se dejan llevar por el viento del modelo, con estelas
   que se desvanecen, coloreadas por intensidad (blanco → ámbar → rojo).
   Usa la pasada determinista del centro elegido, muestreada a mitad de
   cada período de 6 h, así la animación sigue a la línea de tiempo. */

const wind = {
  enabled:
    !window.matchMedia ||
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  data: null,
  particles: [],
  raf: null,
  paused: false,
  fetching: null,
  retryTimer: null,
};
window.__fdcWind = wind; /* para depurar */
window.__fdcWindVec = (lat, lon) =>
  wind.data
    ? windVecAt(lat, lon, Math.max(0, Math.min(euro.step ?? 0, (wind.data.steps || 1) - 1)))
    : null;

/* ═══════════ 4d. HOJA INFERIOR MÓVIL (mapa a pantalla completa) ═════════
   El panel del pronóstico se arrastra con el dedo desde su cabecera: sigue
   el gesto en vivo y al soltar encaja abierto o cerrado según posición y
   velocidad. Un toque simple alterna. Solo aplica en pantallas pequeñas. */
const sheet = { open: false };

function sheetSet(open) {
  sheet.open = open;
  const el = $("panel");
  if (!el) return;
  el.classList.toggle("is-open", open);
  if (!open) el.scrollTop = 0;
}

function sheetInit() {
  const el = $("panel");
  const head = $("sheet-head");
  if (!el || !head) return;
  const mq = window.matchMedia("(max-width: 63.99em)");

  let dragging = false;
  let moved = false;
  let startY = 0;
  let baseY = 0;
  let lastY = 0;
  let t0 = 0;

  const peekPx = () => head.offsetHeight + 14; /* asa + margen visual */
  const closedY = () => el.clientHeight - peekPx();

  head.addEventListener("pointerdown", (e) => {
    if (!mq.matches) return;
    dragging = true;
    moved = false;
    startY = e.clientY;
    lastY = e.clientY;
    baseY = sheet.open ? 0 : closedY();
    t0 = performance.now();
    el.classList.add("is-dragging");
    try {
      head.setPointerCapture(e.pointerId);
    } catch (_) {}
  });

  head.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 6) moved = true;
    lastY = e.clientY;
    const y = Math.max(0, Math.min(closedY(), baseY + dy));
    el.style.transform = `translateY(${y}px)`;
  });

  const finish = (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("is-dragging");
    el.style.transform = "";
    if (!moved) {
      sheetSet(!sheet.open); /* toque simple: alternar */
      return;
    }
    const dt = Math.max(1, performance.now() - t0);
    const v = (lastY - startY) / dt; /* px/ms: + hacia abajo */
    const y = Math.max(0, Math.min(closedY(), baseY + (lastY - startY)));
    if (v < -0.45) return sheetSet(true);
    if (v > 0.45) return sheetSet(false);
    sheetSet(y < closedY() / 2);
  };
  head.addEventListener("pointerup", finish);
  head.addEventListener("pointercancel", finish);

  /* al pasar a escritorio, la hoja vuelve a ser panel normal */
  mq.addEventListener?.("change", () => {
    el.classList.remove("is-open", "is-dragging");
    el.style.transform = "";
    sheet.open = false;
  });
}
sheetInit();

/* PWA: instalable desde el navegador (el SW no cachea nada) */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

function windCovered(reqGrid, modelKey) {
  const d = wind.data;
  if (!d || d.mode === "uv" || d.model !== modelKey || Date.now() - d.at > EURO_CACHE_TTL)
    return false;
  if (d.grid.sp > reqGrid.sp * 1.7) return false;
  const h2 = d.grid.sp / 2;
  return (
    d.grid.lats[0] + h2 >= reqGrid.lats[0] &&
    d.grid.lats[d.grid.lats.length - 1] - h2 <=
      reqGrid.lats[reqGrid.lats.length - 1] &&
    d.grid.lons[0] - h2 <= reqGrid.lons[0] &&
    d.grid.lons[d.grid.lons.length - 1] + h2 >=
      reqGrid.lons[reqGrid.lons.length - 1]
  );
}

function windEnsure() {
  if (!euro.on || !map || !wind.enabled) {
    windStop();
    return;
  }
  const modelKey = euro.variable === "air" ? "ecmwf" : euro.model;

  /* mundial primero: el robot publica u/v del IFS como imagen Mercator
     (R=u, G=v, ±uv_max_ms). Con eso las partículas cubren TODO el mapa;
     la rejilla regional del det.json queda de respaldo (y para AIFS). */
  if (modelKey === "ecmwf") {
    mapaMeta().then((m) => {
      if (!euro.on || !wind.enabled) return;
      if (m && m.uv && m.uv.some(Boolean)) {
        if (windUv.meta !== m) {
          windUv.meta = m;
          windUv.cache.clear();
          windUv.loading.clear();
        }
        wind.data = {
          mode: "uv",
          meta: m,
          steps: m.uv.length,
          model: "ecmwf",
          at: Date.now(),
        };
        windUvLoad(euro.step ?? 0);
        windStart();
      } else windEnsureRegional(modelKey);
    });
    return;
  }
  windEnsureRegional(modelKey);
}

/* respaldo: la rejilla regional u/v del det.json (única fuente del AIFS) */
function windEnsureRegional(modelKey) {
  /* fuente propia: el det.json ya trae u/v listos para las partículas */
  const meta = staticSrc.meta;
  const stc = meta && meta.centers && meta.centers[modelKey];
  if (stc && stc.det) {
    staticFile(modelKey, "det")
      .then((file) => {
        if (file.u && file.v && file.grid) {
          wind.data = {
            grid: file.grid,
            u: file.u,
            v: file.v,
            steps: file.times.length,
            model: modelKey,
            at: Date.now(),
          };
          windStart();
        }
      })
      .catch(() => {});
    return;
  }

  const grid = euroGrid(16, 11);
  const key = `det|${modelKey}|${grid.key}`;

  /* el paquete determinista ya trae el viento: cero peticiones extra
     cuando el usuario está en modo determinista o ya lo visitó */
  const cached = euro.cache.get(key);
  if (cached && Date.now() - cached.at < EURO_CACHE_TTL) {
    wind.data = deriveWindUV(cached.data);
    windStart();
    return;
  }
  if (windCovered(grid, modelKey)) {
    windStart();
    return;
  }
  if (wind.fetching === key) return;

  const now = Date.now();
  const wait = Math.max(
    euro.cooldownUntil - now,
    euro.lastFetch.det + EURO_MIN_INTERVAL.det - now
  );
  if (wait > 0) {
    clearTimeout(wind.retryTimer);
    wind.retryTimer = setTimeout(() => windEnsure(), wait + 300);
    return;
  }
  euro.lastFetch.det = now;
  wind.fetching = key;
  fetchDetBundle(modelKey, grid)
    .then((bundle) => {
      euroCacheSet(key, { data: bundle, at: Date.now() });
      wind.data = deriveWindUV(bundle);
      windStart();
    })
    .catch(() => {
      /* sin animación no se rompe nada: se reintenta en el próximo render */
    })
    .finally(() => {
      if (wind.fetching === key) wind.fetching = null;
    });
}

let windCtx = null;

function windCanvasSetup() {
  const cv = $("wind-canvas");
  const area = cv.parentElement;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, area.clientWidth);
  const h = Math.max(1, area.clientHeight);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function windSpawn(w, h) {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    age: Math.floor(Math.random() * 70),
  };
}

function windStart() {
  if (!wind.enabled || !wind.data || !map || !euro.on) return;
  if (wind.raf) return; /* ya está corriendo */
  windCtx = windCanvasSetup();
  const count = Math.max(
    220,
    Math.min(950, Math.round((windCtx.w * windCtx.h) / 2900))
  );
  wind.particles = Array.from({ length: count }, () =>
    windSpawn(windCtx.w, windCtx.h)
  );
  wind.paused = false;
  $("wind-canvas").style.opacity = "1";
  const loop = () => {
    wind.raf = requestAnimationFrame(loop);
    if (!wind.paused) windFrame();
  };
  wind.raf = requestAnimationFrame(loop);
}

function windStop() {
  if (wind.raf) cancelAnimationFrame(wind.raf);
  wind.raf = null;
  const cv = $("wind-canvas");
  if (cv) {
    const c2 = cv.getContext("2d");
    if (c2) c2.clearRect(0, 0, cv.width, cv.height);
    cv.style.opacity = "0";
  }
}

/* texturas u/v mundiales: se decodifican a píxeles una vez por paso y se
   muestrean por partícula; solo se retienen unas pocas en memoria */
const windUv = { meta: null, cache: new Map(), loading: new Set() };

function windUvLoad(step, esPrecarga) {
  const m = windUv.meta;
  if (!m || !m.uv) return;
  const idx = Math.max(0, Math.min(step ?? 0, m.uv.length - 1));
  const rel = m.uv[idx];
  if (!rel || windUv.cache.has(idx) || windUv.loading.has(idx)) return;
  windUv.loading.add(idx);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    windUv.loading.delete(idx);
    try {
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const c2 = cv.getContext("2d", { willReadFrequently: true });
      c2.drawImage(img, 0, 0);
      windUv.cache.set(idx, {
        px: c2.getImageData(0, 0, cv.width, cv.height).data,
        w: cv.width,
        h: cv.height,
      });
      /* poda: fuera la textura más LEJANA del paso en uso (jamás la activa) */
      while (windUv.cache.size > 6) {
        const cur = Math.max(0, Math.min(euro.step ?? 0, m.uv.length - 1));
        let far = null;
        for (const k of windUv.cache.keys())
          if (far === null || Math.abs(k - cur) > Math.abs(far - cur)) far = k;
        if (far === null || far === idx) break;
        windUv.cache.delete(far);
      }
      /* precarga SOLO el paso siguiente (sin encadenar) para el slider */
      if (!esPrecarga && idx + 1 < m.uv.length) windUvLoad(idx + 1, true);
    } catch (_) {}
  };
  img.onerror = () => windUv.loading.delete(idx);
  img.src = `${STATIC_BASE}/ecmwf/${rel}`;
}

function windVecAtUv(d, lat, lon, s) {
  const m = d.meta;
  const idx = Math.max(0, Math.min(s ?? 0, m.uv.length - 1));
  const t = windUv.cache.get(idx);
  if (!t) {
    windUvLoad(idx);
    return null;
  }
  const b = m.bbox;
  if (lat <= b.south || lat >= b.north) return null;
  const yN = mercY(b.north);
  const yS = mercY(b.south);
  const fx = ((((lon + 180) % 360) + 360) % 360) / 360 * t.w - 0.5;
  const fy = ((yN - mercY(lat)) / (yN - yS)) * t.h - 0.5;
  const y0 = Math.max(0, Math.min(Math.floor(fy), t.h - 2));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const x0 = Math.floor(fx);
  const tx = fx - x0;
  const xw = (x) => ((x % t.w) + t.w) % t.w; /* envuelve el antimeridiano */
  const px = t.px;
  const ch = (x, y, c) => px[(y * t.w + xw(x)) * 4 + c];
  if (
    !ch(x0, y0, 3) || !ch(x0 + 1, y0, 3) ||
    !ch(x0, y0 + 1, 3) || !ch(x0 + 1, y0 + 1, 3)
  )
    return null;
  const bil = (c) =>
    (ch(x0, y0, c) * (1 - tx) + ch(x0 + 1, y0, c) * tx) * (1 - ty) +
    (ch(x0, y0 + 1, c) * (1 - tx) + ch(x0 + 1, y0 + 1, c) * tx) * ty;
  const max = m.uv_max_ms || 40;
  const toMph = (q) => ((q / 255) * 2 * max - max) * 2.236936;
  return { u: toMph(bil(0)), v: toMph(bil(1)) };
}

/* interpolación bilineal del vector de viento en un punto */
function windVecAt(lat, lon, s) {
  const d = wind.data;
  if (d.mode === "uv") return windVecAtUv(d, lat, lon, s);
  const g = d.grid;
  const rows = g.lats.length;
  const cols = g.lons.length;
  const fr = (g.lats[0] - lat) / g.sp;
  const fc = (lon - g.lons[0]) / g.sp;
  if (fr < 0 || fc < 0 || fr > rows - 1 || fc > cols - 1) return null;
  const r0 = Math.min(Math.floor(fr), rows - 2);
  const c0 = Math.min(Math.floor(fc), cols - 2);
  const tr = fr - r0;
  const tc = fc - c0;
  const idx = (r, c) => r * cols + c;
  const bilerp = (arr) => {
    const a = arr[idx(r0, c0)];
    const b = arr[idx(r0, c0 + 1)];
    const c2 = arr[idx(r0 + 1, c0)];
    const d2 = arr[idx(r0 + 1, c0 + 1)];
    /* respuesta incompleta del servicio: mejor sin vector que romper */
    if (!a || !b || !c2 || !d2) return null;
    return (
      (a[s] * (1 - tc) + b[s] * tc) * (1 - tr) +
      (c2[s] * (1 - tc) + d2[s] * tc) * tr
    );
  };
  const u = bilerp(d.u);
  const v = bilerp(d.v);
  if (u == null || v == null || Number.isNaN(u) || Number.isNaN(v)) return null;
  return { u, v };
}

function windFrame() {
  if (!windCtx || !wind.data) return;
  const { ctx, w, h } = windCtx;

  /* desvanece las estelas anteriores */
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "rgba(0,0,0,0.92)";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  ctx.lineWidth = 1.2;

  const s = Math.max(0, Math.min(euro.step ?? 0, wind.data.steps - 1));
  const zoom = map.getZoom ? map.getZoom() : 5;
  const k = 0.055 * Math.pow(2, zoom - 5);

  for (const p of wind.particles) {
    const ll = map.unproject ? map.unproject([p.x, p.y]) : null;
    const vec = ll ? windVecAt(ll.lat, ll.lng, s) : null;
    p.age++;
    if (!vec || p.age > 90) {
      Object.assign(p, windSpawn(w, h), { age: 0 });
      continue;
    }
    const spd = Math.hypot(vec.u, vec.v); /* mph */
    let dx = vec.u * k;
    let dy = -vec.v * k; /* norte = arriba en pantalla */
    const disp = Math.hypot(dx, dy);
    if (disp > 6) {
      dx *= 6 / disp;
      dy *= 6 / disp;
    }
    if (disp < 0.12) p.age += 4; /* aire en calma: recicla pronto */
    const nx = p.x + dx;
    const ny = p.y + dy;
    ctx.strokeStyle =
      spd >= 40
        ? "rgba(255,96,80,0.66)"
        : spd >= 25
          ? "rgba(255,176,32,0.56)"
          : spd >= 15
            ? "rgba(222,230,255,0.4)"
            : "rgba(200,208,235,0.26)";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    p.x = nx;
    p.y = ny;
    if (nx < -12 || ny < -12 || nx > w + 12 || ny > h + 12)
      Object.assign(p, windSpawn(w, h), { age: 0 });
  }
}

$("euro-wind-toggle").checked = wind.enabled;
$("euro-wind-toggle").addEventListener("change", (e) => {
  wind.enabled = e.target.checked;
  if (wind.enabled) windEnsure();
  else windStop();
});

document.addEventListener("visibilitychange", () => {
  wind.paused = document.hidden;
});

let windResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(windResizeTimer);
  windResizeTimer = setTimeout(() => {
    if (wind.raf) {
      windStop();
      windEnsure();
    }
  }, 300);
});

/* controles del panel (solo ECMWF; la variante alterna IFS ↔ AIFS) */
["euro-variant", "euro-var", "euro-mode"].forEach((id) => {
  document.querySelectorAll(`#${id} .seg__btn`).forEach((btn) => {
    btn.addEventListener("click", () => {
      setSegValue(id, btn.dataset.value);
      if (id === "euro-var") euro.variable = btn.dataset.value;
      else if (id === "euro-mode") euro.mode = btn.dataset.value;
      else {
        euro.model = btn.dataset.value; /* "ecmwf" (IFS) o "aifs" — ambos ECMWF */
        /* la variante también rige el panel puntual y el EPS */
        if (currentSpot) loadWeather(currentSpot.lat, currentSpot.lon, currentSpot.label);
      }
      /* acción deliberada del usuario: salta el intervalo entre peticiones
         (el enfriamiento por 429 sí se respeta) */
      euro.lastFetch = { prob: 0, det: 0 };
      euroRefresh();
    });
  });
});

function euroStepMax() {
  const m = mapaSrc.data;
  if (euro.model === "ecmwf" && m && mapaFrames(euro.mode, euro.variable))
    return m.times.length - 1;
  return euro.data ? euro.data.times.length - 1 : 0;
}

/* variable del abanico EPS */
document.querySelectorAll("#eps-fanvar .seg__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setSegValue("eps-fanvar", btn.dataset.value);
    eps.fanVar = btn.dataset.value;
    epsDrawCurrentFan();
  });
});

/* sistema de ensambles (EPS/GEFS/GEPS/ICON/AIFS/Súper/Grand) */
document.querySelectorAll("#eps-model .seg__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setSegValue("eps-model", btn.dataset.value);
    eps.sys = btn.dataset.value;
    try {
      localStorage.setItem("fdc-eps-sys", eps.sys);
    } catch (_) {}
    if (currentSpot) loadEps(currentSpot.lat, currentSpot.lon);
  });
});
setSegValue("eps-model", ENS_SYSTEMS[eps.sys] || ENS_POOLS[eps.sys] ? eps.sys : "eps");

$("euro-slider").addEventListener("input", (e) => {
  euro.step = Number(e.target.value);
  euroRender();
});
$("euro-prev").addEventListener("click", () => {
  if (euro.step > 0) {
    euro.step--;
    euroRender();
  }
});
$("euro-next").addEventListener("click", () => {
  if (euro.step < euroStepMax()) {
    euro.step++;
    euroRender();
  }
});
$("euro-collapse").addEventListener("click", () => {
  $("euro-panel").classList.toggle("is-min");
});

/* ═══════════════════════════  5. BUSCADOR  ══════════════════════════════
   Índice de ciudades propio (GeoNames procesado por el robot): búsqueda
   instantánea en el navegador, sin depender de ninguna API. Si el índice
   no carga, se cae a la API de geocoding de Open-Meteo. */

let searchTimer = null;
let cityIndex = null; /* {cities:[[nombre,admin1,cc,lat,lon,pob]], norm:[]} */
let cityIndexPromise = null;
let countryNamesES = null;

function cityNorm(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/* \u2550\u2550\u2550 b\u00fasqueda GLOBAL por fragmentos (\u00edndice generado por el robot) \u2550\u2550\u2550
   Normalizaci\u00f3n ESPEJO de norm() en build_geodata.py \u2014 si cambias una,
   cambia la otra: NFKD sin marcas, min\u00fasculas con \u00df\u2192ss y \u03c2\u2192\u03c3 (equivalente
   a casefold para lo indexado), y todo lo no alfanum\u00e9rico a espacio. */
function geoNorm(s) {
  s = s.normalize("NFKD").replace(/\p{M}+/gu, "");
  s = s.toLowerCase().replace(/\u00df/g, "ss").replace(/\u03c2/g, "\u03c3");
  s = s.replace(/[^0-9a-z\u0250-\u02af\u0370-\u1fff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff]+/gu, " ");
  return s.replace(/\s+/g, " ").trim();
}

const geoShardCache = new Map(); /* prefijo \u2192 Promise<filas> */

function shardFetch(q) {
  /* fragmento = 2 primeros BYTES utf-8 de la clave normalizada (espejo
     del robot): con CJK/cirílico agrupa por par de bytes y evita miles
     de archivos diminutos */
  const hex = [...new TextEncoder().encode(q).slice(0, 2)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (geoShardCache.has(hex)) return geoShardCache.get(hex);
  const p = (async () => {
    const res = await fetch(`${DATA_REPO}/cities/idx/${hex}.json`);
    if (res.status === 404) return []; /* prefijo sin ciudades: v\u00e1lido */
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  })();
  geoShardCache.set(hex, p);
  p.catch(() => geoShardCache.delete(hex));
  if (geoShardCache.size > 30) geoShardCache.delete(geoShardCache.keys().next().value);
  return p;
}

/* filas: [clave, nombre, admin1, cc, lat, lon, poblaci\u00f3n] (pob desc) */
async function searchShardIndex(query, limit) {
  const q = geoNorm(query);
  /* mínimo 2 BYTES utf-8: dos letras latinas o UN carácter CJK/cirílico */
  if (new TextEncoder().encode(q).length < 2) return [];
  const rows = await shardFetch(q);
  const seen = new Set();
  const hits = [];
  for (const r of rows) {
    if (!r[0].startsWith(q)) continue;
    const id = `${r[1]}|${r[3]}|${r[4]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push([r[0] === q ? 0 : 1, r]);
    if (hits.length >= 60) break;
  }
  hits.sort((a, b) => a[0] - b[0]); /* estable: dentro del score manda la poblaci\u00f3n */
  return hits.slice(0, limit).map(([, r]) => ({
    name: r[1],
    admin1: r[2],
    country: countryES(r[3].toUpperCase()),
    latitude: r[4],
    longitude: r[5],
  }));
}

function countryES(cc) {
  try {
    if (!countryNamesES)
      countryNamesES = new Intl.DisplayNames(["es"], { type: "region" });
    return countryNamesES.of(cc) || cc;
  } catch (_) {
    return cc;
  }
}

function loadCityIndex() {
  if (cityIndexPromise) return cityIndexPromise;
  cityIndexPromise = (async () => {
    try {
      const res = await fetch(`${DATA_REPO}/cities/index.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = await res.json();
      if (!m || !Array.isArray(m.cities) || m.cities.length < 1000)
        throw new Error("índice vacío");
      cityIndex = { cities: m.cities, norm: m.cities.map((c) => cityNorm(c[0])) };
    } catch (_) {
      cityIndexPromise = null; /* se reintenta en la próxima búsqueda */
    }
    return cityIndex;
  })();
  return cityIndexPromise;
}

/* las ciudades vienen ordenadas por población: con empate de calidad de
   coincidencia, gana el lugar más poblado (índice más bajo) */
function searchCityIndex(query, limit) {
  const q = cityNorm(query);
  const { cities, norm } = cityIndex;
  const hits = [];
  for (let i = 0; i < norm.length; i++) {
    const pos = norm[i].indexOf(q);
    if (pos < 0) continue;
    /* 0 exacto · 1 prefijo · 2 prefijo de palabra · 3 dentro */
    const score =
      norm[i] === q ? 0 : pos === 0 ? 1 : norm[i][pos - 1] === " " ? 2 : 3;
    hits.push([score, i]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return hits.slice(0, limit).map(([, i]) => {
    const [name, admin1, cc, lat, lon] = cities[i];
    return {
      name,
      admin1,
      country: countryES(cc),
      latitude: lat,
      longitude: lon,
    };
  });
}

async function searchPlaces(query) {
  const holder = $("search-results");
  let results = null;

  /* 1º el índice global por fragmentos (170k+ lugares, con alternativos
     tipo Kyiv/Kiev y 東京/Tokyo); 2º el índice clásico; 3º la API */
  try {
    results = await searchShardIndex(query, 6);
  } catch (_) {
    results = null;
  }
  if (results === null || results.length === 0) {
    await loadCityIndex();
    if (cityIndex) {
      const legacy = searchCityIndex(query, 6);
      results = results && results.length ? results : legacy;
    }
  }
  if (results === null) {
    /* respaldo final: API de geocoding */
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=es&format=json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      results = data.results || [];
    } catch (_) {
      holder.innerHTML = `<p class="app__search-empty">${t("search_fail")}</p>`;
      holder.classList.add("is-open");
      return;
    }
  }

  if (!results.length) {
    holder.innerHTML = `<p class="app__search-empty">${t("search_empty")}</p>`;
    holder.classList.add("is-open");
    return;
  }

  holder.innerHTML = "";
  results.forEach((r) => {
    const btn = document.createElement("button");
    btn.className = "app__search-item";
    btn.innerHTML = `<ion-icon name="location-outline"></ion-icon><span></span><small></small>`;
    btn.querySelector("span").textContent = r.name;
    btn.querySelector("small").textContent = [r.admin1, r.country]
      .filter(Boolean)
      .join(", ");
    btn.addEventListener("click", () => {
      closeSearch();
      $("place-search").value = r.name;
      const label = `${r.name}${r.admin1 ? ", " + r.admin1 : ""}`;
      loadWeather(r.latitude, r.longitude, label);
      if (map) {
        map.flyTo({ center: [r.longitude, r.latitude], zoom: glZoom(9), duration: 1200 });
        if (clickMarker) clickMarker.remove();
        clickMarker = new window.maplibregl.Marker({ color: "#ffb020" })
          .setLngLat([r.longitude, r.latitude])
          .addTo(map);
      }
    });
    holder.appendChild(btn);
  });
  holder.classList.add("is-open");
}

function closeSearch() {
  $("search-results").classList.remove("is-open");
}

window.__fdcSearch = (q) => searchPlaces(q);

$("place-search").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 2) {
    closeSearch();
    return;
  }
  searchTimer = setTimeout(() => searchPlaces(q), 350);
});

/* precarga del índice al tocar el buscador: la primera búsqueda ya es local */
$("place-search").addEventListener("focus", () => loadCityIndex());

document.addEventListener("click", (e) => {
  if (!e.target.closest(".app__search")) closeSearch();
});

/* ═══════════════════════════  6. AJUSTES (UI)  ══════════════════════════ */

function fillCountrySelect() {
  const sel = $("set-country");
  const src = worldCountries || COUNTRIES;
  const cur = settings.country;
  sel.innerHTML = Object.entries(src)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, "es"))
    .map(([code, c]) => `<option value="${code}">${c.name}</option>`)
    .join("");
  if (src[cur]) sel.value = cur;
}

function segValue(id) {
  const active = document.querySelector(`#${id} .seg__btn.is-active`);
  return active ? active.dataset.value : null;
}

function setSegValue(id, value) {
  document
    .querySelectorAll(`#${id} .seg__btn`)
    .forEach((b) => b.classList.toggle("is-active", b.dataset.value === value));
}

/* refleja el estado real de los controles del mapa en los espejos del modal */
function markActive(containerId, value) {
  document
    .querySelectorAll(`#${containerId} [data-value]`)
    .forEach((b) => b.classList.toggle("is-active", b.dataset.value === value));
}

function settingsSync() {
  const activeLayer = document.querySelector("#layer-seg .seg__btn.is-active");
  const layer = activeLayer ? activeLayer.dataset.layer : "";
  markActive("modal-layer", layer); /* con none, ninguna tarjeta activa */
  for (const src of ["euro-variant", "euro-var", "euro-mode"]) {
    const a = document.querySelector(`#${src} .seg__btn.is-active`);
    if (a) markActive(`modal-${src}`, a.dataset.value);
  }
  const wt = $("euro-wind-toggle");
  const mt = $("modal-wind-toggle");
  if (wt && mt) mt.checked = wt.checked;
}

function openSettings() {
  $("set-country").value = settings.country;
  setSegValue("set-temp", settings.tempUnit);
  setSegValue("set-wind", settings.windUnit);
  setSegValue("set-layer", settings.layer);
  setSegValue("set-fronts", settings.fronts === false ? "off" : "on");
  settingsSync();
  $("settings-modal").classList.add("is-open");
}

/* pestañas del modal de configuración */
document.querySelectorAll("#settings-tabs .seg__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setSegValue("settings-tabs", btn.dataset.value);
    for (const t of ["general", "capas", "modelos"])
      $(`stab-${t}`).hidden = t !== btn.dataset.value;
  });
});

/* espejos: las tarjetas del modal accionan los controles reales del mapa,
   así toda la lógica existente (capas, modelos, cuotas) se reutiliza */
document.querySelectorAll("#modal-layer [data-value]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const src = document.querySelector(`#layer-seg [data-layer="${btn.dataset.value}"]`);
    if (src) src.click();
    settingsSync();
  });
});
/* variable y modo del ECMWF: el modelo acompaña siempre a Radar/Satélite,
   así que el cambio se ve al instante sobre la capa activa */
for (const id of ["euro-variant", "euro-var", "euro-mode"]) {
  document.querySelectorAll(`#modal-${id} [data-value]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const src = document.querySelector(`#${id} [data-value="${btn.dataset.value}"]`);
      if (src) src.click();
      settingsSync();
    });
  });
}
$("modal-wind-toggle").addEventListener("change", () => {
  const wt = $("euro-wind-toggle");
  if (wt && wt.checked !== $("modal-wind-toggle").checked) wt.click();
});

function closeSettings() {
  $("settings-modal").classList.remove("is-open");
}

["set-temp", "set-wind", "set-layer", "set-fronts"].forEach((id) => {
  document.querySelectorAll(`#${id} .seg__btn`).forEach((btn) => {
    btn.addEventListener("click", () => setSegValue(id, btn.dataset.value));
  });
});

/* la tarjeta de "mapa no disponible" ofrece reintentar el arranque */
$("map-retry").addEventListener("click", () => {
  $("map-fallback").classList.remove("is-visible");
  initMap();
});

$("btn-settings").addEventListener("click", openSettings);
$("settings-close").addEventListener("click", closeSettings);
$("settings-modal").addEventListener("click", (e) => {
  if (e.target === $("settings-modal")) closeSettings();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSettings();
});

$("settings-save").addEventListener("click", async () => {
  const before = { ...settings };
  settings = normalizeSettings({
    ...settings /* conserva claves que este formulario no toca (globo, isobaras) */,
    country: $("set-country").value,
    tempUnit: segValue("set-temp"),
    windUnit: segValue("set-wind"),
    layer: segValue("set-layer"),
    fronts: segValue("set-fronts") !== "off",
  });
  persistLocalSettings();
  saveRemoteSettings(auth.currentUser);
  frontsSetVisible(settings.fronts !== false);
  closeSettings();
  toast("Ajustes guardados.");

  const c = countryGet(settings.country) || COUNTRIES.do;
  const countryChanged = before.country !== settings.country;
  const unitsChanged =
    before.tempUnit !== settings.tempUnit || before.windUnit !== settings.windUnit;

  if (countryChanged) {
    if (map) {
      /* con bbox del país (generado) se encuadra la nación completa;
         territorios que cruzan ±180 traen este >180 y MapLibre lo acepta */
      if (c.bbox && map.fitBounds) {
        map.fitBounds(
          [
            [c.bbox[0], c.bbox[1]],
            [c.bbox[2], c.bbox[3]],
          ],
          { padding: 48, duration: 1200, maxZoom: 10 }
        );
      } else {
        map.flyTo({ center: [c.lon, c.lat], zoom: glZoom(c.zoom), duration: 1200 });
      }
    }
    if (clickMarker) {
      clickMarker.remove();
      clickMarker = null;
    }
    loadWeather(c.lat, c.lon, `${c.place}, ${c.name}`);
    countryRender();
  } else if (unitsChanged && currentSpot) {
    loadWeather(currentSpot.lat, currentSpot.lon, currentSpot.label);
  }

  if (before.layer !== settings.layer) setLayer(settings.layer);
});

/* ═══════════════════════════  7. SESIÓN  ════════════════════════════════ */

function paintUser(user) {
  const chip = $("user-chip");
  const name = user.isAnonymous ? "Invitado" : user.displayName || user.email || "Usuario";
  $("user-name").textContent = name;
  $("user-avatar").textContent = user.isAnonymous
    ? "•"
    : (name.trim()[0] || "?").toUpperCase();
  chip.hidden = false;
  $("settings-guest-note").hidden = !user.isAnonymous;
}

$("btn-logout").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (_) {}
  location.replace("acceso.html");
});

/* Reproducir / pausar la animación */
$("btn-play").addEventListener("click", () => {
  if (playing) stopPlayback();
  else startPlayback();
});

/* slider maestro de la capa Nubes: arrastra entre fotogramas observados */
$("obs-slider")?.addEventListener("input", (e) => {
  if (!frames.length || activeKind !== "clouds") return;
  stopPlayback();
  frameIndex = Math.max(0, Math.min(frames.length - 1, Number(e.target.value) || 0));
  satShow(frames[frameIndex]);
  paintFrameLabel();
});

/* isobaras del HRES sobre el modelo */
$("iso-toggle")?.addEventListener("change", (e) => {
  settings.isobars = !!e.target.checked;
  persistLocalSettings();
  saveRemoteSettings(auth.currentUser);
  if (settings.isobars) isoApply(euro.step ?? 0);
  else isoHide();
});

/* ═══ panel de depuración (?debug=1 o #debug): endpoints y su salud ═══
   Lee el registro global de red (window.__fdcFetchLog, Fase 0): último
   estado por endpoint, agrupado por host+ruta. Solo diagnóstico. */
function debugPanelEnsure() {
  if (!/[?#&]debug\b/.test(location.search + location.hash)) return;
  let el = $("fdc-debug");
  if (!el) {
    el = document.createElement("div");
    el.id = "fdc-debug";
    el.className = "fdc-debug";
    document.body.appendChild(el);
  }
  const paint = () => {
    const log = window.__fdcFetchLog || [];
    const last = new Map();
    for (const e of log) {
      try {
        const u = new URL(e.url, location.href);
        const key = u.hostname + u.pathname.split("/").slice(0, 3).join("/");
        last.set(key, e);
      } catch (_) {}
    }
    const rows = [...last.entries()]
      .slice(-30)
      .map(([k, e]) => {
        const okk = e.status && e.status < 400;
        return `<div class="${okk ? "ok" : "bad"}"><b>${e.status ?? "ERR"}</b> ${k}</div>`;
      })
      .join("");
    el.innerHTML = `<strong>Endpoints (${last.size})</strong>${rows}`;
  };
  paint();
  setInterval(paint, 2000);
}
debugPanelEnsure();

/* umbrales del producto diario (Prob. 24 h) */
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest && ev.target.closest("#euro-thr [data-thr]");
  if (!btn) return;
  const key = P24_VAR[euro.variable];
  if (!key) return;
  euro.thr[key] = Number(btn.dataset.thr);
  euroRender();
});

/* compartir el estado actual (enlace profundo) */
$("btn-share")?.addEventListener("click", shareLink);

/* idioma: aplica al instante y repinta lo dinámico */
$("set-lang")?.addEventListener("change", (e) => {
  settings.lang = e.target.value;
  persistLocalSettings();
  saveRemoteSettings(auth.currentUser);
  applyI18n();
  if (currentSpot) loadWeather(currentSpot.lat, currentSpot.lon, currentSpot.label);
  countryRender();
  updateLink();
});

/* proyección globo/plano */
$("globe-btn")?.addEventListener("click", () => {
  settings.globe = settings.globe === false;
  persistLocalSettings();
  saveRemoteSettings(auth.currentUser);
  projectionApply();
});

/* Capas del mapa */
document.querySelectorAll("#layer-seg .seg__btn").forEach((btn) => {
  btn.addEventListener("click", () => setLayer(btn.dataset.layer));
});

/* ═══════════════════════════  8. ARRANQUE  ══════════════════════════════ */

let booted = false;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("acceso.html");
    return;
  }
  if (booted) {
    paintUser(user);
    return;
  }
  booted = true;

  paintUser(user);
  fillCountrySelect();

  /* ajustes: local primero; los remotos (si existen) tienen prioridad */
  settings = normalizeSettings(readLocalSettings());
  const remote = await loadRemoteSettings(user);
  if (remote) {
    settings = normalizeSettings(remote);
    persistLocalSettings();
  }

  $("app-boot").classList.add("is-hidden");

  const isoT = $("iso-toggle");
  if (isoT) isoT.checked = settings.isobars === true;

  /* enlace profundo: restaura idioma/capa/variable/modo/período/punto */
  const dl = parseLink();
  if (dl.lang) settings.lang = dl.lang;
  applyI18n();
  const langSel = $("set-lang");
  if (langSel) langSel.value = settings.lang || "auto";
  if (dl.layer) settings.layer = dl.layer;
  if (dl.variable) euro.variable = dl.variable;
  if (dl.mode) euro.mode = dl.mode;
  if (dl.step != null) euro.step = dl.step;
  if (dl.center) window.__fdcDeepCenter = dl.center;
  ["euro-var", "euro-mode"].forEach((id) =>
    setSegValue(id, id === "euro-var" ? euro.variable : euro.mode)
  );

  const c = countryGet(settings.country) || COUNTRIES.do;
  if (dl.point) loadWeather(dl.point[0], dl.point[1], `${dl.point[0].toFixed(2)}, ${dl.point[1].toFixed(2)}`);
  else loadWeather(c.lat, c.lon, `${c.place}, ${c.name}`);
  initMap();
  /* países globales generados: llegan y refinan selector + panel de país */
  loadCountries();
});
