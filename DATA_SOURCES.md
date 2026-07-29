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

- `GET /v1/marine` con `models=ecmwf_wam025` (`marine-sd.json`): `wave_height, wave_period, wave_direction` con datos (0 nulos); `swell_wave_height` **todo nulo** con este modelo y no se pide.
- **Integrado (Fase 3)**: bloque «Mar» del panel. La detección costera ES la semántica real de la fuente (corrida 30369449924): punto costero → 24/24 horas con dato; Madrid interior → HTTP 200 con **todas las horas nulas**. Si todo llega nulo, el bloque no existe — nada de olas inventadas tierra adentro.

## 7 · Open-Meteo Historical — ERA5 (climatología para EFI)

- `GET https://archive-api.open-meteo.com/v1/archive` con `models=era5` (`era5-sd.json`): **10 624 días** (1991-07-01 → 2020-07-31, ventana de julios de 30 años) en **una** petición de ~245 KB. Serie completa 1991-01-01 → 2020-12-31 verificada en la corrida 29924088008: **10 958 días, 0 nulos, 247 KB, ~2 s**. **Integrado**: bloque «Vs. climatología» del panel — una petición por punto (redondeado a 0.5°, con caché), percentil calculado en el cliente contra los mismos ±10 días de calendario de los 30 años (~630 muestras, el chip enseña cuántas).

## 8 · ECMWF Open Data (AWS Open Data) — GRIB2 crudo, vía el robot

- **Uso real y en producción**: `scripts/build_model_data.py` del repo `fenomenos-datos` descarga IFS det (00/06/12/18z) + ENS 51 miembros (~2 GB/corrida, ~600 kB/s por conexión → descarga por paso en 6 hilos) con el cliente oficial `ecmwf-opendata` y publica: mapa mundial pre-proyectado (74°N–60°S, 0.25°, 16 períodos, det+prob) + rejillas JSON regionales. El cliente web **no** decodifica GRIB: consume webp/JSON estáticos (respuesta práctica a la decisión D4 de AUDIT.md).
- Ciclo del robot: 4×/día (cron 02:50/08:50/14:50/20:50 UTC); `mapa.json.run` lleva la pasada exacta.
- **Campos extra para el rastreador de ciclones** (verificados en la corrida 29924088008 del sondeo): ENS `param=msl` → **25 MB/paso**, 50 miembros pf de 721×1440 (el tipo `cf` **no existe** en el índice del ENS de datos abiertos: «No index entries for type=cf»); ENS `param=t, levtype=pl, levelist=850` → **28 MB/paso**, 50 miembros pf. El det (`stream=oper`) sí trae `msl` y `t850`.

## 9 · Ciclones tropicales — producto propio `modelos/ecmwf/ciclones.json`

- **Entrada**: solo rejillas del ENS/HRES de ECMWF ya descargadas por el robot (10u, 10v, msl, t850). Ningún dato de otro modelo ni de agencias.
- **Método (publicado en el propio JSON, campo `criteria`)**: mínimo de presión **cerrado** (profundidad ≥2 hPa frente al entorno de 14°), vorticidad relativa ciclónica a 10 m ≥3·10⁻⁵ s⁻¹, núcleo cálido en 850 hPa ≥1.0 K, seguimiento en |lat|≤40° con **génesis** en |lat|≤30° y sobre el mar (o a <1° de él, `global-land-mask`), duración ≥24 h en algún miembro, enlace entre pasos de 6 h a ≤450 km, sistemas con ≥3 miembros o señal HRES. Detector validado con vórtices sintéticos en ambos hemisferios (posición exacta, cero falsos positivos en campo plano) **y contra la primera corrida real** (29925164764, pasada 06z del 22-jul): los criterios iniciales daban 143 «sistemas» — bajas extratropicales del invierno austral, bajas térmicas del desierto (Irán, Tarim), Mediterráneo — y el endurecimiento los reduce a los con señal tropical genuina (p. ej. onda del Caribe con 47/50 miembros, Tehuantepec con 46/50).
- **Cuencas**: frontera Atlántico/Pacífico este siguiendo América Central (Tehuantepec → epac), mar Rojo → nio, Pacífico central → epac (avisos CPHC/NOAA), y Atlántico sur separado (`satl`) **sin enlace RSMC** porque no existe un centro de avisos tropicales para esa cuenca — no se inventa ninguno.
- **Salida**: sistemas (cuenca, génesis, nº de miembros y %, máx. mediano en kt, escenarios de rumbo), trayectorias por miembro (`ens`), trayectoria HRES (`det`), y prob. de impacto 34/64 kt en webp (centro a <120 km, sobre rejilla de 0.5°).
- **En la UI**: espaguetis + trayectoria HRES en el mapa, bloque «Ciclones tropicales» en el panel con el descargo permanente «NO es un aviso oficial» y enlace al RSMC de la cuenca. Producto con >12 h se retira (nunca trayectorias viejas como actuales).
- **Enlaces RSMC verificados en vivo** (corrida 29924088008, todos HTTP 200): NHC `nhc.noaa.gov`, JMA `jma.go.jp/bosai/map.html`, IMD `rsmcnewdelhi.imd.gov.in`, Météo-France Reunión `meteofrance.re/fr`, BoM `bom.gov.au/cyclone/`, FMS `met.gov.fj`, MetService NZ `metservice.com/warnings/home`.
- **Las categorías son «equivalentes»**: se derivan del viento máximo a 10 m del modelo (kt brutos); los avisos reales usan promedios de 1/10 min y análisis humano — por eso la UI rotula siempre «equivalente (viento bruto del modelo)».

## 10 · Satélite OBSERVACIONAL (Fase 2 — decisión del dueño: sí)

- **Regla**: «solo ECMWF» aplica a los modelos de PRONÓSTICO. Las imágenes de satélite son **observación** (como los frentes WPC) y viven en su propia capa «Nubes», rotulada «(obs)» y **sin** mezclarse con los campos del modelo (al activarla, el panel ECMWF se oculta).
- **GOES-19 ABI C13** (NOAA `noaa-goes19`, disco completo recortado a América 4–36°N / 112–52°W): el robot publica un fotograma webp cada ~10 min (`goes/meta.json` + `goes/frames/`). Frescura en la app: >2 h ⇒ la capa no lo muestra.
- **GMGSI mosaico geoestacionario global IR** (NOAA, horario, ±72.7°): `world/meta.json` + `world/ir/`. Frescura: >3 h ⇒ fuera.
- Ambos pipelines existían del trabajo previo y estaban dormidos; la Fase 2 los reconecta a la UI. El slider de la capa recorre los fotogramas observados (pasado), separado del slider del modelo (futuro).

## 11 · Productos nuevos del robot (Fase 2)

- **Temperatura 2 m mundial** (`img/det-temp-NN.webp`, en `mapa.json.det.temp`): del mismo GRIB det del IFS (param `2t`), en °C, máx. del período de 6 h, misma proyección/banda que el resto del mapa mundial. Solo determinista — un umbral de probabilidad de temperatura no aporta y no se fabrica.
- **Isobaras MSLP** (`img/iso-NN.json`, en `mapa.json.isobars`, `isobars_step_hpa: 4`): GeoJSON por período con líneas de presión (propiedad `p` en hPa) trazadas del `msl` del HRES (suavizado, recorte a la banda del mapa, submuestreo a 0.5° → decenas de KB por paso). En la app son un conmutador sobre el producto mundial del IFS; con AIFS o la capa de aire no existen y no se pintan.
- **Robots NOAA (GFS) y GEM retirados** (decisión del dueño, Fase 2): la matrix de `modelos.yml` queda `[ecmwf, aifs]`. El código de proceso sigue en el historial de git.

## 12 · Geodatos GENERADOS (Fase 3) — `geo/countries.json` + `cities/idx/`

- **Nada escrito a mano**: `scripts/build_geodata.py` genera todo de Natural Earth `ne_10m_admin_0_countries` (+`map_units` para dependencias como Tokelau) y GeoNames (`cities1000`, `timeZones`, `countryInfo`, `admin1Codes`). Fuentes sondeadas en vivo (corrida 30369449924): NE 258 unidades con `NAME_ES/AR/ZH/RU…`, cities1000 = 170 516 filas con alternativos (Kyiv trae «Kiev», Tokyo trae «東京» y «Tōkyō»).
- **countries.json** (~100 KB): 239+ estados y territorios con ISO a2/a3, nombres en 8 idiomas, husos IANA, bbox (con cruce del antimeridiano: Fiyi `east=181.78`), centroide, zoom, unidades por país, capital con coordenadas, 5 ciudades top y **URL del servicio meteorológico oficial solo si respondió en vivo durante la construcción** (60-63/72 candidatos curados; el resto `null` — p. ej. Grecia falla TLS, Pakistán da 403: quedan null, jamás se adivina).
- **cities/idx/** (~16 MB, ~1100 fragmentos): índice de búsqueda por prefijo (2 primeros **bytes** utf-8 de la clave normalizada — NFKD sin diacríticos + casefold, espejo exacto entre robot y cliente). Claves: nombre + ascii + alternativos latinos (sin códigos IATA) + escrituras nativas (Киев/東京, cupo por población) + palabras no iniciales (≥15k hab). La 1ª corrida pesó 135 MB y se recortó con presupuesto por población — anotado, no escondido.
- **En la app**: selector de país global (todos los territorios, Caribe solo como marca por defecto), panel «País» (capital, top-5 clicables, enlace met verificado o «sin enlace verificado»), búsqueda global con los fragmentos y respaldo (índice clásico → API de geocoding).

## 13 · Geocodificación inversa (clic en el mapa)

- **Purga**: el código anterior llamaba `geocoding-api.open-meteo.com/v1/search?name=&latitude=…` como si fuera inversa. Sondeado en vivo: responde `{"generationtime_ms":…}` **sin resultados** — ese endpoint no existe como inversa y se eliminó (regla cardinal).
- **Ahora**: Photon (komoot, OSM) `photon.komoot.io/reverse` — verificado en vivo (629 ms, devuelve name/city/state/country) — con respaldo Nominatim `jsonv2` (176 ms) y, si ambos fallan (mar abierto), la etiqueta honesta de coordenadas. Caché por punto y ≤1 petición/s (política de uso de ambos servicios).

## 14 · Downscaling, sol polar (evidencia en vivo, corrida 30369449924)

- **Elevación (DEM de Open-Meteo, automático con cada petición)**: Pico Duarte (19.02, −71.00) → `elevation: 3006 m`, temp actual 14.8 °C; Puerto Plata costa (19.79, −70.69) → `elevation: 29 m`, 31.6 °C. Misma celda de 0.25°, 17 °C de diferencia real por altitud. El panel muestra «Altitud del punto» con el valor devuelto.
- **Sol polar (semántica real de la fuente)**: Longyearbyen 78.2 N en julio → `daylight_duration: 86400 s` y salida/puesta degeneradas a `00:00` (día polar); McMurdo 77.85 S → `daylight_duration: 0 s` (noche polar). La losa «Sol» del panel traduce: ≥86 390 s → «Sol de medianoche», ≤10 s → «Noche polar», si no salida–puesta locales con minutos.

## 15 · Probabilidades diarias del ENS — `modelos/ecmwf/prob24.json` (evidencia en vivo, sonda 30411673974)

Producto propio: % de los ~50 miembros perturbados (`pf`) del ENS del IFS que superan cada umbral, por día UTC del pronóstico (4 días), renderizado como imágenes mundiales `img/p24-<var>-<umbral>-<día>.webp`. Todo verificado con peticiones reales desde un runner de GitHub (workflow temporal, corrida 30411673974) antes de escribir el pipeline:

- **Lluvia 24 h (≥5/10/25/50 mm)**: `tp` del ENS es **acumulado desde el inicio de la pasada** (comprobado: en h=0 todos los miembros valen 0; en h=24 el máx. fue 0.765, unidades `m`). Por eso el robot NO suma pasos de 6 h: resta `tp(frontera+24h) − tp(frontera)` por miembro y multiplica ×1000 (m→mm). Equivale exactamente a «sumar los 4 pasos de 6 h» pero con 2 descargas por día en vez de 5.
- **Viento (≥20/35/50 kt)**: `10u/10v` por miembro, `hypot × 1.9438` (m/s→kt), máximo del día sobre los pasos de 6 h. Sin umbrales de 85/100 kt: de huracán informa el NHC, no este producto (decisión del dueño en el encargo).
- **Tmáx (>30/35/40 °C)**: `2t` del ENS **sí existe** (comprobado: 50 miembros `pf`, unidades K, mín 191.9 / máx 322.1, ~31.5 MB por paso). Máximo del día de los pasos de 6 h, −273.15.
- **Rayos: NO DISPONIBLE — producto no construido (regla cardinal)**: se sondearon `litoti`, `litota1`, `litota3` y `litota6` contra el índice del ENS de datos abiertos; los 4 devolvieron «Cannot find index entries» (la densidad de rayos existe en el catálogo interno de ECMWF, pero **no** en el subconjunto abierto). No se sustituye por CAPE ni por ningún otro campo disfrazado de rayos: el producto simplemente no se publica. El lector queda escrito e inerte por si ECMWF lo añade al set abierto.
- **Alineación de miembros**: cada variable diaria se calcula solo sobre la **intersección** de miembros presentes en todos los pasos del día; si quedan <30, ese día no se emite (nada de probabilidades con muestra coja).
- **Nota**: el ENS abierto no publica el miembro de control por separado en el índice (`cf` no aparece; el propio índice sugiere `pf`), así que el conteo típico es 50.

## Límites y atribución

- **Open-Meteo**: gratuito sin clave para uso no comercial (límite documentado por el proveedor ~10 000 llamadas/día; no medido aquí). La app minimiza llamadas (estáticos del robot primero, cachés, intervalos mínimos) y maneja 429 con enfriamiento. Atribución: «Open-Meteo.com» (CC-BY 4.0) — presente en el crédito del mapa.
- **ECMWF Open Data**: licencia CC-BY-4.0; atribución «ECMWF» presente. La leyenda legal completa del pie de página se consolida en Fase 4 (deliverable 6).
- **GeoNames** (índices de ciudades y husos): CC-BY 4.0, atribuido.
- **Natural Earth** (países/territorios): dominio público.
- **Photon (komoot) / Nominatim (OSM)**: geocodificación inversa bajo sus políticas de uso (≤1 pet./s, con caché); datos © OpenStreetMap contributors (ODbL).
- **Esri World Imagery / OpenFreeMap / OpenStreetMap / NOAA WPC**: atribuidos en el crédito del mapa.
