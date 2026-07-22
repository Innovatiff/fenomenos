# DATA_SOURCES.md — Fuentes de datos ECMWF (todas sondeadas en vivo)

**Regla**: ningún endpoint ni parámetro de esta lista se usa en la app sin
haberlo llamado de verdad. Cada entrada cita su evidencia: los archivos de
respuesta cruda viven en la rama
[`fixtures-fase1`](https://github.com/Innovatiff/fenomenos-datos/tree/fixtures-fase1)
del repo de datos (capturados el 2026-07-22 ~02:06 UTC, corrida
[29884877627](https://github.com/Innovatiff/fenomenos-datos/actions/runs/29884877627)),
y las corridas-sonda adicionales se citan por ID. Los puntos de prueba
cubren ambos hemisferios y climas: Santo Domingo, Reikiavik, Singapur,
Perth y McMurdo (−77.85°).

---

## 1 · Open-Meteo `GET /v1/forecast` con `models=ecmwf_ifs025` — IFS determinista

- **Uso en la app**: pronóstico puntual completo (panel), riesgos, y respaldo del mapa.
- **Resolución**: 0.25° (~25 km), la malla abierta del IFS (nativo ~9 km — honestidad de resolución: lo que se sirve es 0.25°). Interpolación horaria de Open-Meteo sobre pasos nativos de 3 h (`temporal_resolution_seconds: 10800` en metadatos).
- **Alcance verificado**: `forecast_days=15` → **15 días completos y 360 horas** en los 5 puntos (fixtures `det-*.json`).
- **Ciclos**: 00/06/12/18z (`update_interval_seconds: 21600`).
- **Parámetros verificados con datos (0 nulos en 5/5 puntos)**: `temperature_2m, apparent_temperature, dew_point_2m, relative_humidity_2m, precipitation, rain, showers, snowfall, snow_depth, pressure_msl, wind_speed_10m, wind_direction_10m, wind_gusts_10m, cloud_cover(+low/mid/high), cape, weather_code, is_day, precipitation_probability`; diario: `weather_code, temperature_2m_max/min, precipitation_sum, snowfall_sum, precipitation_probability_max, wind_speed_10m_max, wind_gusts_10m_max, sunrise, sunset`.
- **Niveles de presión verificados** (`niveles-sd.json`, 0 nulos): `temperature_850hPa, geopotential_height_500hPa, wind_speed/direction_850hPa, wind_speed/direction_200hPa, relative_humidity_700hPa`. La petición **combinada** superficie+niveles en una sola llamada quedó verificada en la sonda v2 (ver informe de fase).
- **NO publicados por el IFS vía Open-Meteo (100 % nulos en 5/5)**: `freezing_level_height`, `visibility`, `uv_index` → la UI los muestra como «—».
- **Con procedencia dudosa**: `precipitation_probability(_max)` devuelve valores bajo `models=ecmwf_ifs025`, pero Open-Meteo no documenta en la respuesta de qué ensemble lo deriva. La sección EPS del panel calcula las probabilidades **desde los miembros crudos**; este campo queda solo en las tarjetas de horas/días y está anotado para sustitución.
- **Unidades**: `temperature_unit`/`wind_speed_unit` respetadas server-side (verificado °F/mph, corrida 29879389749).
- **Zona horaria**: `timezone=auto` → IANA + offset correctos (5/5, incl. `Antarctica/McMurdo`, `Asia/Kathmandu` +5:45). Horas de pared locales del lugar, sin offset.
- **Caso polar**: McMurdo devuelve `sunrise/sunset = "T00:00"` como centinela de noche polar (fixture `det-mcm.json`) — a manejar en Fase 3.
- **Muestra real** (`det-sd.json`): `current: {temperature_2m: 25.9, pressure_msl: 1016.2, is_day: 0…}, timezone: "America/Santo_Domingo"`.

## 2 · Open-Meteo `GET /v1/forecast` con `models=ecmwf_aifs025_single` — AIFS (IA de ECMWF)

- **Uso**: variante seleccionable del panel puntual y de la capa del mapa.
- **Alcance verificado**: 10 días / 240 h (`aifs-sd.json`); `current=` funciona.
- **Con datos**: `temperature_2m, precipitation, wind_speed_10m` + diario básico.
- **SIN datos (100 % nulos)**: `wind_gusts_10m`, `cape` → «—» en el panel; el pedido AIFS omite niveles de presión.

## 3 · Open-Meteo `GET /v1/ensemble` con `models=ecmwf_ifs025` — EPS, 51 miembros

- **Uso**: sección «Probabilidades» del panel (única fuente del modo Probabilidad puntual) y capa de mapa de respaldo.
- **Verificado** (`ens-sd.json`, `ens-rey.json`): **51 series** (control + `_member01…50`) × **168 h** para `temperature_2m` (°C), `precipitation` (mm), `wind_gusts_10m` (km/h), `snowfall` (**cm**); 0 series todo-nulas.
- Todos los porcentajes de la app son conteos directos sobre estas series, mostrados como `N/51`.

### ⚠ AIFS-ENS (`models=ecmwf_aifs025`) — CONGELADO en la fuente (no usar)

- Sondeo real (corrida [29885352154](https://github.com/Innovatiff/fenomenos-datos/actions/runs/29885352154), 2026-07-22): sus metadatos declaran `last_run_initialisation_time: 1740355200` (**24-feb-2025**) y `data_end_time` ≈ 11-mar-2025, aunque el endpoint siga devolviendo 51 series «con datos» (y `wind_gusts_10m` 51/51 todo-nulas). Pintar eso como probabilidad de hoy sería fabricar datos.
- **Mitigación en la app**: compuerta de frescura (`ensFresh`) — con la variante AIFS, la sección de probabilidades y el mapa de Probabilidad exigen metadatos de pasada <48 h; si no, muestran «no se está actualizando — sin datos» y recomiendan IFS HRES.
- Metadatos del AIFS **determinista** (`/data/ecmwf_aifs025_single/static/meta.json`): HTTP 200 verificado (el det del AIFS sí está vivo; fixture `aifs-sd.json` con datos coherentes del día).

## 4 · Metadatos de pasada — `GET /data/ecmwf_ifs025/static/meta.json`

- **Verificado** (`meta-static-meta.json.json`): `last_run_initialisation_time: 1784656800` (= pasada 18z), `last_run_availability_time` (≈ init + 7 h — la latencia de publicación de ECMWF), `temporal_resolution_seconds: 10800`, `update_interval_seconds: 21600`.
- La ruta `/data/ecmwf_ifs025/meta.json` (sin `static/`) **no existe** (404 real).
- Alimenta la línea de procedencia («pasada 18z · hace X h») y la insignia de pasada >7 h.

## 5 · Open-Meteo Air Quality — CAMS (Copernicus/ECMWF)

- `GET /v1/air-quality` con `hourly=us_aqi`: verificado (corrida 29879107502). Modelo servido: CAMS global 0.4° (operado por ECMWF). Uso: variable «Aire» y riesgo de aire. Estado: retenido bajo la decisión D3 de AUDIT.md.

## 6 · Open-Meteo Marine — olas del ECMWF WAM

- `GET /v1/marine` con `models=ecmwf_wam025` (`marine-sd.json`): `wave_height, wave_period, wave_direction` con datos (0 nulos); `swell_wave_height` **todo nulo** con este modelo. Aún no integrado en UI (Fase 3, detección costera).

## 7 · Open-Meteo Historical — ERA5 (climatología para EFI)

- `GET https://archive-api.open-meteo.com/v1/archive` con `models=era5` (`era5-sd.json`): **10 624 días** (1991-07-01 → 2020-07-31, ventana de julios de 30 años) en **una** petición de ~245 KB. Serie completa 1991-01-01 → 2020-12-31 verificada en la corrida 29924088008: **10 958 días, 0 nulos, 247 KB, ~2 s**. **Integrado**: bloque «Vs. climatología» del panel — una petición por punto (redondeado a 0.5°, con caché), percentil calculado en el cliente contra los mismos ±10 días de calendario de los 30 años (~630 muestras, el chip enseña cuántas).

## 8 · ECMWF Open Data (AWS Open Data) — GRIB2 crudo, vía el robot

- **Uso real y en producción**: `scripts/build_model_data.py` del repo `fenomenos-datos` descarga IFS det (00/06/12/18z) + ENS 51 miembros (~2 GB/corrida, ~600 kB/s por conexión → descarga por paso en 6 hilos) con el cliente oficial `ecmwf-opendata` y publica: mapa mundial pre-proyectado (74°N–60°S, 0.25°, 16 períodos, det+prob) + rejillas JSON regionales. El cliente web **no** decodifica GRIB: consume webp/JSON estáticos (respuesta práctica a la decisión D4 de AUDIT.md).
- Ciclo del robot: 4×/día (cron 02:50/08:50/14:50/20:50 UTC); `mapa.json.run` lleva la pasada exacta.
- **Campos extra para el rastreador de ciclones** (verificados en la corrida 29924088008 del sondeo): ENS `param=msl` → **25 MB/paso**, 50 miembros pf de 721×1440 (el tipo `cf` **no existe** en el índice del ENS de datos abiertos: «No index entries for type=cf»); ENS `param=t, levtype=pl, levelist=850` → **28 MB/paso**, 50 miembros pf. El det (`stream=oper`) sí trae `msl` y `t850`.

## 9 · Ciclones tropicales — producto propio `modelos/ecmwf/ciclones.json`

- **Entrada**: solo rejillas del ENS/HRES de ECMWF ya descargadas por el robot (10u, 10v, msl, t850). Ningún dato de otro modelo ni de agencias.
- **Método (publicado en el propio JSON, campo `criteria`)**: mínimo de presión **cerrado** (profundidad ≥2 hPa frente al entorno de 14°), vorticidad relativa ciclónica a 10 m ≥3·10⁻⁵ s⁻¹, núcleo cálido en 850 hPa ≥0.5 K, banda |lat|≤40°, enlace entre pasos de 6 h a ≤450 km, sistemas con ≥3 miembros o señal HRES. Detector validado con vórtices sintéticos en ambos hemisferios (posición exacta, cero falsos positivos en campo plano).
- **Salida**: sistemas (cuenca, génesis, nº de miembros y %, máx. mediano en kt, escenarios de rumbo), trayectorias por miembro (`ens`), trayectoria HRES (`det`), y prob. de impacto 34/64 kt en webp (centro a <120 km, sobre rejilla de 0.5°).
- **En la UI**: espaguetis + trayectoria HRES en el mapa, bloque «Ciclones tropicales» en el panel con el descargo permanente «NO es un aviso oficial» y enlace al RSMC de la cuenca. Producto con >12 h se retira (nunca trayectorias viejas como actuales).
- **Enlaces RSMC verificados en vivo** (corrida 29924088008, todos HTTP 200): NHC `nhc.noaa.gov`, JMA `jma.go.jp/bosai/map.html`, IMD `rsmcnewdelhi.imd.gov.in`, Météo-France Reunión `meteofrance.re/fr`, BoM `bom.gov.au/cyclone/`, FMS `met.gov.fj`, MetService NZ `metservice.com/warnings/home`.
- **Las categorías son «equivalentes»**: se derivan del viento máximo a 10 m del modelo (kt brutos); los avisos reales usan promedios de 1/10 min y análisis humano — por eso la UI rotula siempre «equivalente (viento bruto del modelo)».

## Límites y atribución

- **Open-Meteo**: gratuito sin clave para uso no comercial (límite documentado por el proveedor ~10 000 llamadas/día; no medido aquí). La app minimiza llamadas (estáticos del robot primero, cachés, intervalos mínimos) y maneja 429 con enfriamiento. Atribución: «Open-Meteo.com» (CC-BY 4.0) — presente en el crédito del mapa.
- **ECMWF Open Data**: licencia CC-BY-4.0; atribución «ECMWF» presente. La leyenda legal completa del pie de página se consolida en Fase 4 (deliverable 6).
- **GeoNames** (índice de ciudades): CC-BY, atribuido.
- **Esri World Imagery / OpenFreeMap / OpenStreetMap / NOAA WPC**: atribuidos en el crédito del mapa.
