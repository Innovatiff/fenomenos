/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — app.js
   Fenómenos App: mapa interactivo (Leaflet + CARTO), radar y satélite en
   vivo (RainViewer), pronóstico por horas y 7 días (Open-Meteo) y ajustes
   por usuario (localStorage siempre; Firestore users/{uid} si la cuenta
   no es anónima). Requiere sesión: sin usuario se vuelve a acceso.html.
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
};

let settings = { ...DEFAULT_SETTINGS };

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
    if (COUNTRIES[data.country]) out.country = data.country;
    if (data.tempUnit === "fahrenheit") out.tempUnit = "fahrenheit";
    if (data.windUnit === "mph") out.windUnit = "mph";
    if (["radar", "satellite", "none"].includes(data.layer)) out.layer = data.layer;
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
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString("es", { weekday: "short", day: "numeric" });
}

function fmtClock(date) {
  return date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

/* ═══════════════════════════  3. PRONÓSTICO  ════════════════════════════ */

let currentSpot = null; /* {lat, lon, label} */
let weatherAbort = null;

async function loadWeather(lat, lon, label) {
  currentSpot = { lat, lon, label };
  if (weatherAbort) weatherAbort.abort();
  weatherAbort = new AbortController();

  $("now-place").textContent = label;
  $("now-updated").textContent = "Actualizando…";

  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,pressure_msl,is_day",
    hourly: "temperature_2m,precipitation_probability,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: "7",
    timezone: "auto",
    temperature_unit: settings.tempUnit,
    wind_speed_unit: settings.windUnit === "mph" ? "mph" : "kmh",
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: weatherAbort.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderNow(data);
    renderHours(data);
    renderDays(data);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    $("now-updated").textContent = "No se pudo cargar el pronóstico.";
    toast("Sin conexión con el servicio del tiempo.", "error");
  }
}

function renderNow(data) {
  const c = data.current || {};
  const info = weatherInfo(c.weather_code, c.is_day);

  $("now-temp").textContent = `${Math.round(c.temperature_2m ?? 0)}${tempSymbol()}`;
  $("now-desc").textContent = info.text;
  $("now-icon").innerHTML = `<ion-icon name="${info.icon}"></ion-icon>`;
  $("now-updated").textContent = `Actualizado a las ${fmtClock(new Date())}`;

  const stats = [
    { icon: "thermometer-outline", label: "Sensación", value: `${Math.round(c.apparent_temperature ?? 0)}${tempSymbol()}` },
    { icon: "water-outline", label: "Humedad", value: `${Math.round(c.relative_humidity_2m ?? 0)}%` },
    { icon: "flag-outline", label: "Viento", value: `${Math.round(c.wind_speed_10m ?? 0)} ${windSymbol()}` },
    { icon: "flash-outline", label: "Ráfagas", value: `${Math.round(c.wind_gusts_10m ?? 0)} ${windSymbol()}` },
    { icon: "speedometer-outline", label: "Presión", value: `${Math.round(c.pressure_msl ?? 0)} hPa` },
    { icon: "rainy-outline", label: "Lluvia", value: `${(c.precipitation ?? 0).toFixed(1)} mm` },
  ];

  $("now-grid").innerHTML = stats
    .map(
      (s) => `
      <div class="now__stat">
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
      <div class="hour${i === start ? " hour--now" : ""}">
        <span class="hour__time">${i === start ? "Ahora" : fmtHour(times[i])}</span>
        <ion-icon name="${info.icon}"></ion-icon>
        <span class="hour__temp">${Math.round(h.temperature_2m?.[i] ?? 0)}°</span>
        <span class="hour__rain"><ion-icon name="water-outline"></ion-icon>${rain ?? 0}%</span>
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
      <div class="day">
        <span class="day__name">${fmtDayName(date, i)}</span>
        <ion-icon name="${info.icon}" title="${info.text}"></ion-icon>
        <span class="day__rain"><ion-icon name="water-outline"></ion-icon>${d.precipitation_probability_max?.[i] ?? 0}%</span>
        <span class="day__temps">
          <span class="day__max">${Math.round(d.temperature_2m_max?.[i] ?? 0)}°</span>
          <span class="day__min">${Math.round(d.temperature_2m_min?.[i] ?? 0)}°</span>
        </span>
      </div>`;
    })
    .join("");
}

/* ═══════════════════════════  4. MAPA  ══════════════════════════════════ */

let map = null;
let baseLayer = null;
let weatherLayer = null;
let clickMarker = null;

/* RainViewer */
let rvData = null;
let frames = [];
let frameIndex = 0;
let playing = false;
let playTimer = null;
let activeKind = "radar";

function waitForLeaflet(timeoutMs = 6000) {
  return new Promise((resolve) => {
    const started = Date.now();
    (function check() {
      if (window.L) return resolve(window.L);
      if (Date.now() - started > timeoutMs) return resolve(null);
      setTimeout(check, 120);
    })();
  });
}

async function initMap() {
  const L = await waitForLeaflet();
  if (!L) {
    $("map-fallback").classList.add("is-visible");
    return;
  }

  const c = COUNTRIES[settings.country];
  map = L.map("map", {
    center: [c.lat, c.lon],
    zoom: c.zoom,
    minZoom: 3,
    maxZoom: 12,
    zoomControl: true,
    attributionControl: false,
  });

  baseLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    { subdomains: "abcd", maxZoom: 12 }
  );
  baseLayer.addTo(map);
  $("map-credit").hidden = false;

  map.on("click", onMapClick);

  await loadRainViewer();
  setLayer(settings.layer, { silent: true });
}

function onMapClick(e) {
  const { lat, lng } = e.latlng;
  const label = `${lat.toFixed(2)}, ${lng.toFixed(2)}`;

  if (clickMarker) clickMarker.remove();
  clickMarker = window.L.marker([lat, lng]).addTo(map);
  clickMarker.bindPopup(`Pronóstico para <strong>${label}</strong>`).openPopup();

  loadWeather(lat, lng, `Punto ${label}`);
  reverseGeocode(lat, lng);
}

/* nombre legible del punto tocado (mejora la etiqueta si hay conexión) */
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=&latitude=${lat}&longitude=${lon}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const hit = data.results && data.results[0];
    if (hit && currentSpot && Math.abs(currentSpot.lat - lat) < 0.001) {
      $("now-place").textContent = `${hit.name}${hit.admin1 ? ", " + hit.admin1 : ""}`;
    }
  } catch (_) {}
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
    weatherLayer.remove();
    weatherLayer = null;
  }

  if (kind === "none" || !map) {
    $("playbar").classList.remove("is-visible");
    return;
  }

  frames = framesFor(kind);
  if (!frames.length) {
    $("playbar").classList.remove("is-visible");
    if (!silent)
      toast(
        kind === "radar"
          ? "El radar no está disponible ahora mismo."
          : "El satélite no está disponible ahora mismo.",
        "error"
      );
    return;
  }

  /* arranca en el último fotograma "pasado" (el más actual) */
  frameIndex = kind === "radar" && rvData.radar && rvData.radar.past
    ? Math.max(rvData.radar.past.length - 1, 0)
    : frames.length - 1;

  weatherLayer = window.L.tileLayer(tileUrl(kind, frames[frameIndex]), {
    opacity: 0.75,
    maxZoom: 12,
  });
  weatherLayer.addTo(map);

  $("frame-kind").textContent = kind === "radar" ? "Radar" : "Satélite";
  paintFrameLabel();
  $("playbar").classList.add("is-visible");
}

function paintFrameLabel() {
  const frame = frames[frameIndex];
  if (!frame) return;
  const date = new Date(frame.time * 1000);
  const isFuture = frame.time * 1000 > Date.now();
  $("frame-time").textContent = `${fmtClock(date)}${isFuture ? " (pronóstico)" : ""}`;
}

function stepFrame() {
  if (!frames.length || !weatherLayer) return;
  frameIndex = (frameIndex + 1) % frames.length;
  weatherLayer.setUrl(tileUrl(activeKind, frames[frameIndex]));
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

/* ═══════════════════════════  5. BUSCADOR  ══════════════════════════════ */

let searchTimer = null;

async function searchPlaces(query) {
  const holder = $("search-results");
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=es&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = data.results || [];

    if (!results.length) {
      holder.innerHTML = `<p class="app__search-empty">Sin resultados para tu búsqueda.</p>`;
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
          map.flyTo([r.latitude, r.longitude], 9, { duration: 1.2 });
          if (clickMarker) clickMarker.remove();
          clickMarker = window.L.marker([r.latitude, r.longitude]).addTo(map);
        }
      });
      holder.appendChild(btn);
    });
    holder.classList.add("is-open");
  } catch (_) {
    holder.innerHTML = `<p class="app__search-empty">No se pudo buscar. Revisa tu conexión.</p>`;
    holder.classList.add("is-open");
  }
}

function closeSearch() {
  $("search-results").classList.remove("is-open");
}

$("place-search").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 2) {
    closeSearch();
    return;
  }
  searchTimer = setTimeout(() => searchPlaces(q), 350);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".app__search")) closeSearch();
});

/* ═══════════════════════════  6. AJUSTES (UI)  ══════════════════════════ */

function fillCountrySelect() {
  const sel = $("set-country");
  sel.innerHTML = Object.entries(COUNTRIES)
    .map(([code, c]) => `<option value="${code}">${c.name}</option>`)
    .join("");
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

function openSettings() {
  $("set-country").value = settings.country;
  setSegValue("set-temp", settings.tempUnit);
  setSegValue("set-wind", settings.windUnit);
  setSegValue("set-layer", settings.layer);
  $("settings-modal").classList.add("is-open");
}

function closeSettings() {
  $("settings-modal").classList.remove("is-open");
}

["set-temp", "set-wind", "set-layer"].forEach((id) => {
  document.querySelectorAll(`#${id} .seg__btn`).forEach((btn) => {
    btn.addEventListener("click", () => setSegValue(id, btn.dataset.value));
  });
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
    country: $("set-country").value,
    tempUnit: segValue("set-temp"),
    windUnit: segValue("set-wind"),
    layer: segValue("set-layer"),
  });
  persistLocalSettings();
  saveRemoteSettings(auth.currentUser);
  closeSettings();
  toast("Ajustes guardados.");

  const c = COUNTRIES[settings.country];
  const countryChanged = before.country !== settings.country;
  const unitsChanged =
    before.tempUnit !== settings.tempUnit || before.windUnit !== settings.windUnit;

  if (countryChanged) {
    if (map) map.flyTo([c.lat, c.lon], c.zoom, { duration: 1.2 });
    if (clickMarker) {
      clickMarker.remove();
      clickMarker = null;
    }
    loadWeather(c.lat, c.lon, `${c.place}, ${c.name}`);
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

  const c = COUNTRIES[settings.country];
  loadWeather(c.lat, c.lon, `${c.place}, ${c.name}`);
  initMap();
});
