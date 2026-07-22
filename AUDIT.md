# AUDIT.md — Fase 0: Auditoría y purga

**Alcance**: Fenómenos App (`app.html` + `js/app.js` + sitio) y el repo público
de datos `Innovatiff/fenomenos-datos`. Auditoría ejecutada con barridos
exhaustivos por archivo:línea sobre ambos repos, dos sondas con respuestas
reales de API desde runners de GitHub Actions, y pruebas reales de zonas
horarias/unidades en Node. **Nada de lo afirmado aquí es especulación: cada
punto tiene archivo:línea, salida de prueba o ID de corrida verificable.**

---

## 0 · Correcciones a las premisas del encargo

El brief describe un estado anterior del código. Estado real verificado:

| Premisa del brief | Realidad verificada |
|---|---|
| "Current stack: Leaflet" | La app corre sobre **MapLibre GL JS 5.24** desde el commit `c4472dc` ("Migrate the app map from Leaflet to MapLibre GL"). No queda ni una llamada a Leaflet; solo un comentario de cabecera obsoleto lo mencionaba (purgado en esta fase). |
| "The map currently fails to initialize… dead-end card" | El fallo de inicialización fue diagnosticado a causa raíz y corregido (commit `9763faf`, ver §1). La tarjeta sí era un callejón sin salida: **corregido en esta fase** (botón Reintentar + reintentos con backoff + failover). |
| "a satellite layer, RainViewer radar" | Las capas de radar/satélite observacionales fueron retiradas de la vista por orden del dueño (commit `7aecd3c`); su código y pipelines quedan **dormidos** a la espera de la decisión de Fase 2 (§6-D2). |
| "settings panel scaffolding" | El panel de ajustes es funcional (país, unidades, capa inicial, frentes, variable/modo del modelo, partículas). |

---

## 1 · Fallo de inicialización del mapa — causa raíz (no síntoma)

**Causa raíz**: se pasaba `maxBounds [[-180,-85],[180,85]]` al constructor de
MapLibre GL. Un `maxBounds` que abarca **exactamente 360° de longitud** hace
que la matemática interna de constreñimiento (`_constrain`/`_calcMatrices`)
produzca una transformación nula → `TypeError` en `_calcMatrices` → lienzo
en blanco y la tarjeta "El mapa no está disponible". Reproducido y verificado
contra la librería **real** `maplibre-gl@5.24` (no contra stubs) en un
navegador controlado; el mismo harness confirma que el arreglo elimina el
fallo.

**Arreglo (commit `9763faf`)**: `renderWorldCopies: false` + `setMaxBounds`
**después** de construir el mapa, con un mundo ligeramente recortado
`[[-179.9,-80],[179.9,84]]` y envuelto en `try/catch` (`js/app.js`, initMap).

**Endurecimiento añadido en esta fase** (verificado con prueba real
`fallback-test.mjs`, 4/4 asertos):

- `resolveMapStyle()`: **failover** OpenFreeMap → CARTO **+ 3 rondas de
  reintentos con espera creciente** (700·2ⁿ ms). Antes: una sola pasada.
- La tarjeta degradada ya **no es un callejón sin salida**: botón
  **Reintentar** que rearranca `initMap()` (guard anti doble-init); el panel
  de pronóstico sigue funcionando sin mapa (degradado pero usable).
- **Registro de red**: wrapper global de `fetch` — TODA petición queda en
  `window.__fdcFetchLog` (anillo de 300, con status/ms/error) y todo fallo
  se avisa por consola. Nada falla en silencio aunque el `catch` local
  esté vacío.

**Deuda conocida del arreglo** (para Fase 2, §7): `renderWorldCopies:false`
+ bounds ±179.9° impiden la vista contigua del antimeridiano (Fiyi,
Kiribati, Chukotka) y el límite sur −80 recorta el interior antártico.

---

## 2 · Purga de modelos no-ECMWF

### 2.1 Ruta OCULTA no-ECMWF encontrada y corregida (la más grave)

El **pronóstico puntual** (panel: ahora/24 h/7 días) y el **panel de
riesgos** llamaban a `api.open-meteo.com/v1/forecast` **sin `models=`** →
Open-Meteo servía **"best match"**, una mezcla multi-modelo (GFS y otros).
Cada temperatura del panel violaba la regla 1 sin que se notara.

**Corrección**: `models: "ecmwf_ifs025"` añadido a la petición
(`js/app.js`, loadWeather). `refreshRisks` consume el mismo payload → los
medidores de riesgo también quedan 100 % ECMWF.

**Verificación con respuestas reales** (protocolo anti-fabricación; sondas
desde runners porque el sandbox no alcanza Open-Meteo):

- Corrida [29879107502](https://github.com/Innovatiff/fenomenos-datos/actions/runs/29879107502):
  `models=ecmwf_ifs025` responde 200 con series completas en Santo Domingo,
  **McMurdo (−77.85°)** y Katmandú; `timezone=auto` devuelve la IANA
  correcta (`Antarctica/McMurdo` +12 en invierno austral, `Asia/Kathmandu`
  +5:45).
- Corrida [29879389749](https://github.com/Innovatiff/fenomenos-datos/actions/runs/29879389749):
  el juego **exacto** de parámetros del panel (current + hourly con `cape`,
  `is_day` + daily + unidades °F/mph) funciona íntegro con ECMWF
  (p. ej. `cape: [1510, 1470, 1400]` J/kg en Santo Domingo; Ulán Bator
  completo).
- **Hallazgo**: `uv_index` con ECMWF llega **72/72 nulo** (el UV del "best
  match" venía de otros modelos). El panel puntual **no pide UV** hoy, así
  que no hay número fabricado en pantalla; si se añade UV en Fase 1 deberá
  ser "sin datos" o CAMS (decisión D3).

### 2.2 Referencias eliminadas (app, `js/app.js` salvo indicación)

| Qué | Dónde estaba | Acción |
|---|---|---|
| Adaptadores `noaa` (GFS/GEFS) y `gem` (GDPS/GEPS) de `EURO_MODELS_CFG` | bloques `noaa:{det:"gfs_global",ens:"gfs025"…}` y `gem:{det:"gem_global"…}` | **Eliminados por completo** (eran además inalcanzables: `euro.model` fijo en `"ecmwf"`, cero reasignaciones en todo el repo — verificado) |
| Comentario "tres centros… NOAA — GFS… GEM (Canadá)…" | cabecera de `EURO_MODELS_CFG` | Reescrito a solo-ECMWF |
| Comentario "(EPS / GEFS / GEPS)" | `fetchEuroProb` | Reescrito (EPS / AIFS-ENS) |
| Cabecera del archivo "Leaflet + CARTO… RainViewer" | `js/app.js:1-7` | Reescrita: MapLibre + solo-ECMWF |
| Comentario "ECMWF, NOAA y GEM Canadá" | `app.html` (euro-panel) | Reescrito |
| Crédito "Open-Meteo (ECMWF · AIFS · NOAA · ECCC · CAMS)" + "RainViewer" | `app.html` (map-credit) | Ahora: "NOAA WPC · Open-Meteo (ECMWF · CAMS) · GeoNames" (WPC = frentes observacionales en pantalla) |
| **WeatherNext (Google DeepMind)** — workflow + script sonda | `.github/workflows/weathernext.yml`, `scripts/build_weathernext.py` | **Eliminados** (modelo no-ECMWF; recuperables en historial git si algún día se revierte la regla) |
| README: capas y "tres centros", GFS/GEFS/GEPS | `README.md` | Secciones reescritas al estado solo-ECMWF real |

**Retenido a propósito**:
- `aifs` en `EURO_MODELS_CFG` — **AIFS es ECMWF** (permitido; el selector
  de variante IFS/AIFS llega en Fase 1). Hoy inalcanzable y anotado así.
- **CAMS** (calidad del aire) — operado por **ECMWF/Copernicus**; no es un
  NWP del listado prohibido. Marcado como decisión D3.
- **Frentes WPC** — producto **observacional/análisis humano**, no un
  modelo. Marcado como decisión D2 y con su límite declarado (solo cubre
  Norteamérica/Atlántico — no es global).

### 2.3 Rutas muertas de radar/satélite (no-modelo) — puestas a dormir

Tras la retirada de "nuvecitas" quedaban **fetches vivos alimentando nada**:
RainViewer + metas GOES/lluvia/radar/mosaico se pedían en cada arranque y
cada 5 min. **Eliminadas las llamadas** (solo se piden ahora frentes, lo
único visible); las funciones quedan dormidas y comentadas como tales a la
espera de D2. Verificado en runtime (`solo-ecmwf-test.mjs`): 0 llamadas a
RainViewer, 0 metas GOES/radar/mundo, frentes sí, y **toda** petición a
`/v1/forecast` y al ensemble lleva `models=ecmwf`.

### 2.4 Pipelines no-ECMWF del repo de datos (decisión D1, no ejecutado)

`fenomenos-datos` sigue publicando **noaa/** (GFS+GEFS 31 miembros),
**gem/** (GDPS+GEPS) y **aifs/det.json** en cada corrida (4×/día) **sin
ningún consumidor** (la app solo lee `meta.json`, `ecmwf/*`). Propuesta:
podar la matriz de `modelos.yml` a `[ecmwf]` y los builders/`BUILDERS` de
`build_model_data.py`. No lo ejecuté: es infraestructura del dueño en un
repo compartido — pido confirmación (§6-D1).

---

## 3 · Hardcodes caribeños (catálogo completo)

### 3.1 Limitaciones globales REALES (impiden funcionar en los casos del brief)

| # | Dónde | Qué limita | Efecto concreto |
|---|---|---|---|
| G1 | `fenomenos-datos/scripts/build_model_data.py` (`LAT_MIN/MAX 4–36`, `LON −112/−52`) | Rejillas JSON det/prob del robot solo Caribe ampliado | El **popup de valores** y el respaldo regional no existen fuera de esa caja; el resto del mundo depende del mapa webp + Open-Meteo |
| G2 | `build_model_data.py` (`MAPA_LAT_N 74 / MAPA_LAT_S −60`) | Clamp del mapa mundial ECMWF | **Svalbard (78.2 N) y McMurdo (77.9 S) quedan sin capa de modelo** pese al comentario "todos los países habitados". El mosaico observacional GMGSI sí llega a ±80 — el modelo puede y debe ampliarse (Fase 2) |
| G3 | `js/app.js` euroGrid (clamps 74/−60/76) | Respaldo por API + partículas + popup | Sin campo del modelo por API sobre ~76 N ni bajo 60 S |
| G4 | `js/app.js` initMap (`renderWorldCopies:false`, bounds ±179.9, −80/84) | Antimeridiano y polos | Sin vista contigua de Fiyi/Kiribati/Chukotka; Antártida interior recortada. Es la contención del bug §1: se sustituye en Fase 2 (globo/proyección), no se parchea a ciegas |
| G5 | `js/app.js` `COUNTRIES` (12 países) + `normalizeSettings` + select "País principal" | Selector de inicio cerrado | Un usuario de Mongolia no puede fijar su país de inicio (el mapa y el pronóstico sí le funcionan al tocar/buscar). Fase 3 lo sustituye por el picker global generado |
| G6 | `fenomenos-datos/scripts/build_cities.py` (`REGION` 37 países, tope 80 k) | Índice del buscador | Fuera de Caribe/Centroamérica solo ciudades ≥15 000 hab. Fase 3: índice global cities500 |
| G7 | Frentes WPC | Producto regional | Solo Norteamérica/Atlántico; se declara en UI en Fase 2 (o se retira, D2) |

### 3.2 Defaults de marca (permitidos por el brief, sin cambio)

Centro/zoom inicial Santo Domingo, `DEFAULT_SETTINGS.country="do"`, textos
de marca "Caribe" en portada/manifest. El Caribe es la vista por defecto,
**no** un límite funcional (verificado: el mapa pana el mundo entero, el
pronóstico puntual responde en McMurdo/Ulán Bator/Katmandú con datos
reales — §2.1).

### 3.3 Semántica horaria actual (documentada con precisión)

- **Panel puntual**: se pide `timezone=auto`; Open-Meteo devuelve horas de
  pared **locales del lugar** sin offset; la app las re-emite tal cual →
  las etiquetas horarias del lugar son correctas (hora local del lugar).
  Caso borde conocido: fechas de pared inexistentes en la tz del NAVEGADOR
  (transición DST del navegador) podrían desplazarse una hora al parsear —
  riesgo bajo, se elimina en Fase 1 al formatear con `Intl` +
  `timeZone` explícito de la respuesta.
- **Línea de tiempo del modelo**: épocas UTC formateadas en la tz del
  **espectador** (elección deliberada, igual que los grandes visores).
- El runtime es plenamente capaz de tz globales (pruebas §5).

---

## 4 · Flags DEV/mock — inventario exigido

**Ninguno en producción.** Búsquedas en TODO el repo (js, html, css, sw.js,
manifest, .github/, scripts/): `mock|stub|fake|dummy|FIXME|__stub|DEV|DEBUG`
→ **0 resultados** en código de producción. Ningún archivo del repo lee
`__stub_auth` ni flags de prueba de `localStorage` (claves usadas:
`fdc-app-settings`, `fdc-euro-cache-v1`, `fdc-euro-cooldown`, comentarios).
El harness de pruebas (Playwright) vive **fuera del repo** (scratchpad de
sesión) y funciona por intercepción de red del navegador de prueba: **no
puede alcanzar producción**.

Globales de introspección siempre expuestos (solo lectura, no flags):
`window.__fdcModuleOk`, `__fdcMap`, `__fdcEuro`, `__fdcWind`,
`__fdcFetchLog`.

**Fabricaciones encontradas y corregidas en esta fase**:

| Qué | Riesgo | Corrección |
|---|---|---|
| `?? 0` en renderNow/renderHours/renderDays (temperatura, humedad, viento, ráfagas, presión, lluvia, % lluvia) | Un `null` de la API se pintaba como **0 real** (0°, 0 %, 0 hPa) | Helper `numOr()`: todo dato ausente se muestra **"—"** (sin datos). Regla cardinal aplicada |
| Formulario de alertas por correo (`js/script.js`) mostraba "Listo. Te avisaremos…" **sin enviar nada a ningún proveedor** | Promesa falsa a usuarios reales | Mensaje honesto: "Las alertas por correo aún no están disponibles" |
| `precipitation_probability(_max)` de Open-Meteo | Devuelve valores con `models=ecmwf_ifs025`, pero su derivación interna (qué ensemble usa Open-Meteo) **no es verificable desde la respuesta** | Documentado como procedencia incierta; en Fase 1 se sustituye por P(precip) calculada por nosotros desde los 51 miembros reales del EPS |

---

## 5 · Zonas horarias y unidades — resultados de pruebas REALES

### 5.1 Zonas horarias (Node v22, ICU 78.2 **full-icu** verificado)

Script real (`tz-test.mjs`), offsets medidos con `Intl.DateTimeFormat`
(`longOffset`) el 15-ene-2026 y 15-jul-2026:

| Zona | Ene (verano austral) | Jul | Esperado | Resultado |
|---|---|---|---|---|
| Asia/Kathmandu | +05:45 | +05:45 | +05:45 fijo | **PASS** |
| Pacific/Chatham | +13:45 | +12:45 | DST austral 45 min | **PASS** |
| Australia/Lord_Howe | +11:00 | +10:30 | **DST de 30 min** | **PASS** |
| Asia/Tehran | +03:30 | +03:30 | sin DST desde 2022 | **PASS** |
| Pacific/Kiritimati | +14:00 | +14:00 | +14 fijo | **PASS** |
| Pacific/Apia | +13:00 | +13:00 | sin DST desde 2021 | **PASS** |
| Australia/Eucla | +08:45 | +08:45 | +08:45 fijo | **PASS** |

**14/14 PASS** (7 zonas × 2 fechas), incluidos DST invertido del hemisferio
sur, offsets de 30/45 min y aboliciones recientes. El lado API también
verificado en vivo (§2.1): `timezone=auto` devolvió IANA + offset correctos
en los tres puntos sondeados.

### 5.2 Unidades

- **Cómo funciona hoy**: temperatura y viento se piden **convertidos por
  Open-Meteo** (`temperature_unit=`, `wind_speed_unit=` en la URL) — sin
  conversión propia C↔F en JS. Única conversión propia: `toKmh()`
  (mph→km/h, factor exacto 1.609344) para normalizar umbrales de riesgo, y
  `MS_TO_MPH=2.236936` en el pipeline Python.
- **Round-trip real ejecutado** (`units-test.mjs`, 20 valores con negativos
  y decimales): mph→km/h→mph err. máx. **2.8e-14**; m/s→mph→m/s err. máx.
  **1.4e-14**. **Exactos a precisión de double.** (La constante Python está
  truncada: error relativo 1.3e-7 = 0.000029 mph a 100 m/s — despreciable,
  se documenta.)
- **Carencias para el brief** (evidencia: greps con 0 resultados en ambos
  repos): **kt**, **m/s** como unidad de UI, **mm/in**
  (`precipitation_unit` nunca se envía) y **hPa/inHg/mmHg** (única presión:
  "hPa" fijo). Defaults por país: no existen (Fase 3/4).
- **Inconsistencia detectada**: la capa del modelo fuerza **mph** en
  leyendas/umbrales aunque el usuario elija km/h (el panel puntual sí
  respeta la preferencia). Corrección planificada en Fase 1 (las imágenes
  del robot llevan la paleta en mph horneada; exige regenerar leyendas por
  unidad o rotular la unidad con claridad).

---

## 6 · Decisiones que te corresponden (con recomendación)

- **D1 — Retirar los pipelines NOAA/GEM/AIFS del repo de datos.** Hoy
  publican JSONs sin lectores 4×/día. *Recomiendo retirarlos* (matriz
  `[ecmwf]` + poda de builders) y conservar todo en historial git. AIFS:
  retirar su JSON del robot pero **mantener** la variante AIFS vía
  Open-Meteo para Fase 1 (es ECMWF).
- **D2 — Imaginería observacional (satélite GOES/GMGSI, radar MRMS/
  RainViewer, frentes WPC) bajo la regla solo-ECMWF.** No son modelos de
  pronóstico; el brief lo reserva explícitamente como decisión tuya
  (Fase 2 la detalla por región/cobertura). Mientras tanto: capas dormidas,
  pipelines publicando, frentes visibles (análisis, rotulado como tal).
  *Recomiendo permitir observacionales* con etiquetado de procedencia.
- **D3 — CAMS (calidad del aire y, en el futuro, UV).** CAMS lo opera
  ECMWF (Copernicus). *Recomiendo mantenerlo* etiquetado "CAMS ·
  Copernicus/ECMWF"; si prefieres pureza IFS/EPS estricta, se retira la
  variable Aire.
- **D4 — GRIB de ECMWF Open Data desde hosting estático** (pregunta del
  brief): la arquitectura actual ya responde el problema — el robot
  pre-procesa GRIB→webp/JSON en Actions y el cliente no decodifica nada.
  Queda para Fase 1 sondear CORS/rangos del bucket para features que pidan
  grids crudos en el cliente; *recomiendo mantener el pre-render*.

---

## 7 · Riesgos conocidos y trabajo diferido (entra en Fases 1–4)

1. G1–G7 (§3.1): cobertura polar del mapa del modelo, antimeridiano/globo,
   picker global de países, índice global de ciudades.
2. Formato horario del panel con `Intl`+`timeZone` explícito (§3.3).
3. Unidades kt/m·s⁻¹/in/inHg + defaults por país + leyendas del modelo en
   la unidad del usuario (§5.2).
4. `precipitation_probability` → ensemble propio (§4).
5. Procedencia visible en cada número ("ECMWF IFS · pasada 12z · …"):
   los metadatos existen (run/generated en `mapa.json`, `utc_offset` y
   modelo en cada respuesta) pero **no se muestran** aún — Fase 4.
6. `weather_code` con ECMWF es una derivación de Open-Meteo sobre campos
   ECMWF (documentar como tal en la UI de procedencia).
7. El `euro-sub` dice "51 escenarios" como fallback textual cuando aún no
   hay datos; con datos reales muestra el conteo real (50 hoy). Ajustar a
   "—" hasta tener el dato (Fase 1, junto con la procedencia).

## 8 · Verificación de esta fase (todo ejecutado, no supuesto)

- `fallback-test.mjs` — 4/4: tarjeta con Reintentar, 6 intentos
  registrados, fallos anotados, reintento arranca el mapa.
- `solo-ecmwf-test.mjs` — 5/5: `/v1/forecast` y ensemble siempre con
  `models=ecmwf`, 0 RainViewer, 0 metas dormidas, frentes vivos.
- Regresión completa — `ecmwf-global-test` 10/10, `no-clouds-test` 2/2,
  `satbase-test` 4/4.
- Sondas API reales: corridas 29879107502 y 29879389749 (fenomenos-datos).
- `node --check` en `js/app.js` y `js/script.js`.
