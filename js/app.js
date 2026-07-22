/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — app.js
   Consola meteorológica sobre MapLibre GL. ÚNICO modelo de pronóstico:
   ECMWF (IFS determinista + EPS ensemble; AIFS también es ECMWF). El
   pronóstico puntual, los riesgos y la capa del mapa piden SIEMPRE
   models=ecmwf_ifs025 — nunca el "best match" multi-modelo. Datos del
   robot propio (fenomenos-datos) + Open-Meteo; ajustes por usuario
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
    if (data.fronts === false) out.fronts = false;
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
  return d.toLocaleDateString("es", { weekday: "short", day: "numeric", timeZone: "UTC" });
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
  $("now-updated").textContent = "Actualizando…";

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
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_gusts_10m_max",
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
  } catch (err) {
    if (err && err.name === "AbortError") return;
    $("now-updated").textContent = "No se pudo cargar el pronóstico.";
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
  $("now-updated").textContent = `Actualizado a las ${fmtClock(new Date())}`;

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
    { icon: "thermometer-outline", label: "Sensación", value: numOr(c.apparent_temperature, (v) => `${Math.round(v)}${tempSymbol()}`) },
    { icon: "water-outline", label: "Humedad", value: numOr(c.relative_humidity_2m, (v) => `${Math.round(v)}%`) },
    { icon: "flag-outline", label: "Viento", value: numOr(c.wind_speed_10m, (v) => `${Math.round(v)} ${windSymbol()}`) },
    { icon: "flash-outline", label: "Ráfagas", value: numOr(c.wind_gusts_10m, (v) => `${Math.round(v)} ${windSymbol()}`) },
    { icon: "speedometer-outline", label: "Presión", value: numOr(c.pressure_msl, (v) => `${Math.round(v)} hPa`) },
    { icon: "rainy-outline", label: "Lluvia", value: numOr(c.precipitation, (v) => `${v.toFixed(1)} mm`) },
    { icon: "thermometer-outline", label: "Punto de rocío", value: numOr(hv("dew_point_2m"), (v) => `${Math.round(v)}${tempSymbol()}`) },
    {
      icon: "cloud-outline",
      label: "Nubes baja·media·alta",
      value: cloudTri.every((v) => v == null)
        ? "—"
        : cloudTri.map((v) => (v == null ? "—" : Math.round(v))).join("·") + " %",
    },
    { icon: "flash-outline", label: "CAPE", value: numOr(hv("cape"), (v) => `${Math.round(v)} J/kg`) },
    /* el IFS abierto NO publica estos tres: "—" honesto, jamás un invento */
    { icon: "snow-outline", label: "Isoterma 0°", value: numOr(hv("freezing_level_height"), (v) => `${Math.round(v)} m`) },
    { icon: "eye-outline", label: "Visibilidad", value: numOr(hv("visibility"), (v) => `${(v / 1000).toFixed(1)} km`) },
    { icon: "sunny-outline", label: "Índice UV", value: numOr(hv("uv_index"), (v) => `${Math.round(v)}`) },
  ];

  /* nieve: solo cuando hay señal (en el trópico sería ruido permanente) */
  const snowNow = hv("snowfall");
  const snowDepth = hv("snow_depth");
  if ((snowNow != null && snowNow > 0) || (snowDepth != null && snowDepth > 0)) {
    stats.push({ icon: "snow-outline", label: "Nieve (1 h · manto)", value: `${numOr(snowNow, (v) => v.toFixed(1) + " cm")} · ${numOr(snowDepth, (v) => (v * 100).toFixed(0) + " cm")}` });
  }

  /* altura (solo IFS: el AIFS abierto no publica niveles de presión) */
  const t850 = hv("temperature_850hPa");
  const z500 = hv("geopotential_height_500hPa");
  const shear = shearDeep(hv("wind_speed_850hPa"), hv("wind_direction_850hPa"), hv("wind_speed_200hPa"), hv("wind_direction_200hPa"));
  if (t850 != null || z500 != null) {
    stats.push(
      { icon: "trending-up-outline", label: "Temp. 850 hPa", value: numOr(t850, (v) => `${Math.round(v)}${tempSymbol()}`) },
      { icon: "layers-outline", label: "Altura 500 hPa", value: numOr(z500, (v) => `${Math.round(v)} m`) },
      { icon: "swap-horizontal-outline", label: "Cizalla 850–200", value: numOr(shear, (v) => `${Math.round(v)} ${windSymbol()}`) }
    );
  }

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
      <div class="day">
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
    $("prov-text").textContent = `${label} · pasada: sin datos`;
    $("prov-badge").hidden = true;
    return;
  }
  const init = meta.last_run_initialisation_time * 1000;
  const d = new Date(init);
  const ageH = (Date.now() - init) / 3600000;
  const runTxt = `${String(d.getUTCHours()).padStart(2, "0")}z (${d.getUTCDate()} ${d.toLocaleDateString("es", { month: "short", timeZone: "UTC" })})`;
  $("prov-text").textContent = `${label} · pasada ${runTxt} · hace ${ageH < 1 ? Math.round(ageH * 60) + " min" : Math.round(ageH) + " h"}`;
  /* insignia de pasada vieja (>7 h). Ojo: la propia latencia de
     publicación de ECMWF ronda 7 h — ver el informe de fase */
  $("prov-badge").hidden = ageH <= 7;
}

/* ═══════  3a-tris. PROBABILIDADES REALES DEL EPS (51 MIEMBROS)  ══════════
   Cada porcentaje de esta sección sale de CONTAR miembros del ensemble de
   ECMWF que superan un umbral, y el conteo (N/51) se muestra al lado para
   que cualquiera pueda verificarlo. Nada de probabilidades de caja negra. */

const eps = { key: null, abort: null, data: null };

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

/* percentiles por hora a través de los miembros */
function epsFanData(members) {
  const n = members[0] ? members[0].length : 0;
  const fan = { p10: [], p25: [], p50: [], p75: [], p90: [], sd: [] };
  for (let t = 0; t < n; t++) {
    const vals = [];
    for (const m of members) if (m[t] != null) vals.push(m[t]);
    vals.sort((a, b) => a - b);
    fan.p10.push(qSorted(vals, 0.1));
    fan.p25.push(qSorted(vals, 0.25));
    fan.p50.push(qSorted(vals, 0.5));
    fan.p75.push(qSorted(vals, 0.75));
    fan.p90.push(qSorted(vals, 0.9));
    if (vals.length > 1) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      fan.sd.push(Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length - 1)));
    } else {
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

async function loadEps(lat, lon) {
  const cfg = EURO_MODELS_CFG[euro.model] || EURO_MODELS_CFG.ecmwf;
  const key = `${lat.toFixed(2)}|${lon.toFixed(2)}|${cfg.ens}`;
  const block = $("eps-block");
  if (!block) return;
  block.hidden = false;
  $("eps-title").textContent = cfg.ensName;
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
  try {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: "temperature_2m,precipitation,wind_gusts_10m,snowfall",
      forecast_days: "7",
      timezone: "auto",
      models: cfg.ens,
      temperature_unit: "celsius" /* umbrales en °C; se convierte al pintar */,
      wind_speed_unit: "kmh",
    });
    const res = await fetch(`https://ensemble-api.open-meteo.com/v1/ensemble?${params}`, {
      signal: eps.abort.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const d = Array.isArray(raw) ? raw[0] : raw;
    eps.data = { at: Date.now(), hourly: d.hourly || {}, ensName: cfg.ensName };
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

function epsRender() {
  if (!eps.data) return;
  const h = eps.data.hourly;
  const times = h.time || [];
  const temps = epsSeries("temperature_2m");
  const rains = epsSeries("precipitation");
  const gusts = epsSeries("wind_gusts_10m");
  const snows = epsSeries("snowfall");
  const N = temps.length;
  if (!N || !times.length) {
    $("eps-head").textContent = "Sin datos del ensemble ahora mismo.";
    return;
  }

  const fan = epsFanData(temps);
  /* confianza: dispersión media (σ) de la temperatura en las próximas 72 h */
  const sd72 = fan.sd.slice(0, 72).filter((v) => v != null);
  const sdMean = sd72.length ? sd72.reduce((a, b) => a + b, 0) / sd72.length : null;
  const conf = sdMean == null ? null : sdMean < 1.0 ? "alta" : sdMean < 2.2 ? "media" : "baja";
  $("eps-head").textContent =
    `${N} escenarios · dispersión media ±${sdMean == null ? "—" : sdMean.toFixed(1)} °C (72 h)` +
    (conf ? ` · confianza ${conf.toUpperCase()}` : "");
  const cb = $("conf-badge");
  if (cb) {
    cb.hidden = conf == null;
    cb.textContent = `confianza ${conf || "—"}`;
    cb.dataset.level = conf || "";
  }

  epsDrawFan(times, temps, fan);
  $("eps-legend").hidden = false;

  /* ── tablas de umbral con conteos reproducibles ── */
  const days = [...new Set(times.map((t) => t.slice(0, 10)))].slice(0, 3);
  const rows = [];

  /* lluvia por día */
  const rainSums = rains.map((m) => epsDailySums(times, m));
  for (const day of days) {
    const chips = EPS_RAIN_THR.map((thr) => {
      const c = rainSums.filter((s) => (s.get(day) || 0) > thr).length;
      return epsChip(Math.round((100 * c) / N), c, N, `>${thr} mm`);
    }).join("");
    rows.push(`<div class="eps-row"><span class="eps-row__label">Lluvia · ${fmtDayName(day, days.indexOf(day))}</span><div class="eps-chips">${chips}</div></div>`);
  }

  /* ráfagas máximas en 48 h */
  const gustMax = gusts.map((m) => {
    let mx = null;
    for (let i = 0; i < Math.min(48, m.length); i++) if (m[i] != null && (mx == null || m[i] > mx)) mx = m[i];
    return mx;
  });
  const gustChips = EPS_GUST_THR.map(({ kt, kmh }) => {
    const c = gustMax.filter((v) => v != null && v > kmh).length;
    return epsChip(Math.round((100 * c) / N), c, N, `>${kmh} km/h (${kt} kt)`);
  }).join("");
  rows.push(`<div class="eps-row"><span class="eps-row__label">Ráfagas · próximas 48 h</span><div class="eps-chips">${gustChips}</div></div>`);

  /* helada y calor por día (mín/máx del día por miembro, °C) */
  const tMin = temps.map((m) => epsDailyExtreme(times, m, Math.min));
  const tMax = temps.map((m) => epsDailyExtreme(times, m, Math.max));
  const frostChips = days
    .map((day, i) => {
      const c = tMin.filter((s) => s.has(day) && s.get(day) < 0).length;
      return epsChip(Math.round((100 * c) / N), c, N, fmtDayName(day, i));
    })
    .join("");
  rows.push(`<div class="eps-row"><span class="eps-row__label">Helada (mín &lt; 0 °C)</span><div class="eps-chips">${frostChips}</div></div>`);
  const heatChips = days
    .map((day, i) => {
      const c = tMax.filter((s) => s.has(day) && s.get(day) > 35).length;
      return epsChip(Math.round((100 * c) / N), c, N, fmtDayName(day, i));
    })
    .join("");
  rows.push(`<div class="eps-row"><span class="eps-row__label">Calor (máx &gt; 35 °C)</span><div class="eps-chips">${heatChips}</div></div>`);

  /* nieve: solo si algún miembro da algo (>0.1 cm/día) */
  const snowSums = snows.map((m) => epsDailySums(times, m));
  const anySnow = days.some((day) => snowSums.some((s) => (s.get(day) || 0) > 0.1));
  if (anySnow) {
    for (const day of days) {
      const chips = [1, 5, 20].map((thr) => {
        const c = snowSums.filter((s) => (s.get(day) || 0) > thr).length;
        return epsChip(Math.round((100 * c) / N), c, N, `>${thr} cm`);
      }).join("");
      rows.push(`<div class="eps-row"><span class="eps-row__label">Nieve · ${fmtDayName(day, days.indexOf(day))}</span><div class="eps-chips">${chips}</div></div>`);
    }
  }

  $("eps-thresholds").innerHTML = rows.join("");
  const note = $("eps-note");
  note.hidden = false;
  note.textContent =
    `Cada porcentaje es el conteo directo de los ${N} escenarios del ${eps.data.ensName} que superan el umbral (se muestra N/${N}). ` +
    "Confianza: σ media de temperatura a 72 h — alta < 1.0 °C, media < 2.2 °C, baja ≥ 2.2 °C. Umbrales de helada/calor fijos (0 °C / 35 °C).";

  /* estructura expuesta para verificación externa (pruebas de aceptación) */
  window.__fdcEpsCalc = { members: N, sdMean, conf, days };
}

/* abanico de percentiles + espagueti de todos los miembros */
function epsDrawFan(times, members, fan) {
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
  band(fan.p25, fan.p75, "rgba(122,162,255,0.26)");
  ctx.beginPath();
  for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(fan.p50[i]));
  ctx.strokeStyle = "rgba(255,224,138,0.95)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  /* eje: mín y máx */
  ctx.fillStyle = "rgba(196,208,240,0.7)";
  ctx.fillText(`${Math.round(hi - pad)}°`, 4, 14);
  ctx.fillText(`${Math.round(lo + pad)}°`, 4, H - 20);
}

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
  const day = d.toLocaleDateString("es", { weekday: "short", day: "numeric" });
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
    await loadFronts();
    frontsApply();
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

  const c = COUNTRIES[settings.country];
  map = new gl.Map({
    container: "map",
    style: styleUrl,
    center: [c.lon, c.lat],
    zoom: glZoom(c.zoom),
    minZoom: 2,
    /* el estilo vectorial es nítido a cualquier zoom y la base satelital
       llega a ~19: acercarse mucho ya no se ve pixelado */
    maxZoom: 18,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    /* un solo mundo: sin copias infinitas a los lados */
    renderWorldCopies: false,
  });
  if (map.touchZoomRotate && map.touchZoomRotate.disableRotation)
    map.touchZoomRotate.disableRotation();
  /* bordes de arrastre: un pelo por dentro de ±180°/±85° — el mundo
     completo exacto hace fallar el constreñimiento interno de MapLibre */
  try {
    map.setMaxBounds([
      [-179.9, -80],
      [179.9, 84],
    ]);
  } catch (_) {
    /* si algún navegador no lo soporta, el mapa sigue vivo sin límites */
  }
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
    weatherTilesRemove();
    weatherLayer = null;
  }
  satOverlayRemove();
  satMode = null;
  radarOwnRemove();
  radarMode = null;

  /* con Satélite el suelo es imagen real de alta resolución */
  satBaseShow(kind === "satellite");

  /* Radar = mapa cartográfico · Satélite = imagen real: en ambos el
     protagonista es SOLO el modelo ECMWF, sin nubes ni radar encima.
     "Sin capa" deja el mapa limpio. */
  euroSetActive(kind === "radar" || kind === "satellite", { silent });
  $("playbar").classList.remove("is-visible");
}

function paintFrameLabel() {
  const frame = frames[frameIndex];
  if (!frame) return;
  const date = new Date(frame.time * 1000);
  const isFuture = frame.time * 1000 > Date.now();
  $("frame-time").textContent = `${fmtClock(date)}${isFuture ? " (pronóstico)" : ""}`;
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
  if (d.variable !== euro.variable) return false;
  if (!isAir && (d.mode !== euro.mode || d.model !== euro.model)) return false;
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
    hourly: "wind_speed_10m,wind_gusts_10m,precipitation,wind_direction_10m",
    forecast_days: String(EURO_DAYS),
    timeformat: "unixtime",
    timezone: "UTC",
    wind_speed_unit: "mph",
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
    dir: (loc.hourly.wind_direction_10m || []).map((v) =>
      v == null ? null : Math.round(v)
    ),
  }));
  return { kind: "bundle", grid, times, hourly, model: modelKey, at: Date.now() };
}

const BUNDLE_VAR = { wind: "speed", gusts: "gusts", rain: "precip" };

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
  const day = from.toLocaleDateString("es", { weekday: "short", day: "numeric" });
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
  $("euro-loading").hidden = true;

  $("euro-title").textContent = prob ? cfg.probTitle : cfg.detTitle;
  $("euro-sub").textContent = prob
    ? `EPS de ECMWF · ${m.members || 51} escenarios · mundial`
    : "IFS de ECMWF · determinista (0.25°) · mundial";
  $("euro-mode").style.display = "";
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

function euroRender() {
  if (!map) return;
  /* el mapa mundial en imágenes tiene prioridad (mejor calidad y global);
     SOLO existe para el IFS — con la variante AIFS o la capa de aire se
     sigue el camino clásico (rejilla del robot / API) */
  if (euro.variable !== "air" && euro.model === "ecmwf") {
    const modeSel = euro.mode;
    const files = mapaFrames(modeSel, euro.variable);
    if (files) {
      euroRenderMapa(files, modeSel);
      return;
    }
  }
  const d = euro.data;
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
  /* el aire no tiene ensemble */
  $("euro-mode").style.display = isAir ? "none" : "";
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
  /* la calidad del aire no tiene ensemble: siempre es determinista */
  const isAir = euro.variable === "air";
  const mode = isAir ? "det" : euro.mode;

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
  if (!d || d.model !== modelKey || Date.now() - d.at > EURO_CACHE_TTL)
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

/* interpolación bilineal del vector de viento en un punto */
function windVecAt(lat, lon, s) {
  const d = wind.data;
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

  await loadCityIndex();
  if (cityIndex) {
    results = searchCityIndex(query, 6);
  } else {
    /* respaldo: API de geocoding */
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=es&format=json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      results = data.results || [];
    } catch (_) {
      holder.innerHTML = `<p class="app__search-empty">No se pudo buscar. Revisa tu conexión.</p>`;
      holder.classList.add("is-open");
      return;
    }
  }

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

  const c = COUNTRIES[settings.country];
  const countryChanged = before.country !== settings.country;
  const unitsChanged =
    before.tempUnit !== settings.tempUnit || before.windUnit !== settings.windUnit;

  if (countryChanged) {
    if (map)
      map.flyTo({ center: [c.lon, c.lat], zoom: glZoom(c.zoom), duration: 1200 });
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
