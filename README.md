# Fenómenos del Caribe — sitio web

Sitio estático **mobile-first** con el lenguaje de diseño original (vidrio azul
profundo, bordes de gradiente, tipografía Gugi, malla del hero con haces de
luz). El sitio ya no depende de fenomenosdelcaribe.org: tiene sus propias
páginas y su propio sistema de publicación de artículos sobre Firebase.

## Estructura

```
fenomenos/
├── index.html          ← portada (los «Últimos artículos» se cargan de Firestore)
├── articulos.html      ← listado público de artículos, filtros por etiqueta + búsqueda
├── articulo.html       ← lector de un artículo (articulo.html?id=…)
├── proximamente.html   ← página puente para las herramientas aún no migradas
├── acceso.html         ← puerta de Fenómenos App: sesión, registro o invitado
├── app.html            ← FENÓMENOS APP: mapa, radar/satélite, pronóstico
├── estudio.html        ← ⚠ EL SOFTWARE (privado): crear/editar/publicar artículos
├── css/
│   ├── style.css       ← base del sitio (tokens, header, cards, footer…)
│   ├── articles.css    ← páginas públicas de artículos + próximamente
│   ├── app.css         ← acceso.html + app.html (Fenómenos App)
│   └── estudio.css     ← estilos del Estudio
├── js/
│   ├── script.js       ← interacción general (header, malla, reveals…)
│   ├── firebase-init.js← configuración e inicialización de Firebase
│   ├── db.js           ← lecturas públicas de Firestore
│   ├── render-article.js ← renderizador compartido (público + vista previa)
│   ├── index-articles.js ← últimos artículos en portada
│   ├── articles-page.js  ← listado con filtros y búsqueda
│   ├── article-page.js   ← lector de artículo
│   ├── acceso.js         ← autenticación de la app (correo, registro, invitado)
│   ├── app.js            ← toda la lógica de Fenómenos App
│   └── estudio.js        ← toda la lógica del Estudio
└── img/                ← logo, favicons
```

Sin build step. Súbelo tal cual a GitHub Pages, Netlify o Vercel.

## El Estudio de publicación (`estudio.html`)

Página **sin enlaces desde el sitio**: solo se entra escribiendo la URL
(`https://tudominio/estudio.html`). Requiere iniciar sesión con **Firebase
Authentication** (correo y contraseña) **y** que el UID de esa cuenta esté
en la colección `admins` de Firestore (ver «Puesta en marcha»). Las cuentas
creadas desde Fenómenos App no pueden entrar aunque tengan contraseña.

Qué permite:

- **Dos pestañas** (Artículos, Etiquetas); la pestaña **Editor** aparece al
  abrir un artículo (editar o nuevo).
- **Crear artículos** con título, etiqueta (desplegable), resumen, imagen de
  portada (URL o subida con compresión automática) y pie de artículo.
- **Contenido por secciones**: subtítulos, párrafos, imágenes, citas y listas.
  Las secciones se **reordenan arrastrando** el asa (o con los botones ↑ ↓).
- **Texto enriquecido en los párrafos**: negrita, cursiva, subrayado,
  marcador y alineación (inicio/centro/final) sobre el texto seleccionado.
  El HTML resultante pasa por una lista blanca estricta (`sanitizeHtml`).
- **Subtítulos con tamaño elegible** (pequeño/normal/grande/extra grande).
- **Caja de revisión**: vista previa en vivo fija junto al formulario en
  pantallas anchas, además de la vista previa a pantalla completa.
- **Guardar borrador / Publicar**: al publicar, el artículo aparece al instante
  en `articulos.html` y en la portada.
- **Editar y eliminar** artículos existentes, y **despublicar** (volver a
  borrador) desde el listado.
- **Gestor de etiquetas**: la lista que alimenta el desplegable del editor y
  los filtros de la página pública. (Pensadas para tener páginas propias por
  etiqueta más adelante.)

La página pública del artículo (`articulo.html`) tiene layout de artículo
real: columna ancha + barra lateral fija que acompaña el scroll con el
índice «En este artículo» (resaltado según avanzas), caja de compartir
(WhatsApp, Facebook, X, copiar enlace) y «Más artículos», además de una
barra de progreso de lectura.

## Fenómenos App (`app.html` + `acceso.html`)

El botón **«Lanzar app»** del header lleva a `acceso.html`, donde se puede
**iniciar sesión, crear una cuenta o entrar como invitado** (sesión anónima
de Firebase). Una vez dentro, `app.html` ofrece:

- **Mapa interactivo** (MapLibre GL + estilo vectorial oscuro) centrado en
  el país elegido; al tocar cualquier punto se carga su pronóstico.
- **ÚNICO modelo de pronóstico: ECMWF.** Sin GFS, sin GEM, sin mezclas
  «best match»: cada número del mapa y del panel es atribuible al centro
  europeo (regla del proyecto; AIFS, la variante de IA de ECMWF, también
  está permitida). La capa del modelo se ve **en todo el planeta** con
  imágenes pre-renderizadas por el robot (0.25° nativo, proyección
  Mercator exacta) sobre dos fondos: **Mapa** (cartográfico oscuro) o
  **Satélite** (imagen real del terreno, Esri World Imagery):
  - **Probabilidad**: porcentaje de los 51 escenarios del **EPS de
    ECMWF** que superan un umbral peligroso por período de 6 horas —
    viento sostenido **> 25 mph**, ráfagas **> 40 mph** o lluvia
    **> 25 mm en 6 h** (riesgo de inundaciones).
  - **Determinista**: la pasada oficial del **IFS 0.25°** (máximo de
    viento/ráfagas o lluvia acumulada por período).
  - **Aire**: índice AQI del **CAMS** (Copernicus, operado por ECMWF).
  - **Viento en movimiento**: partículas animadas que siguen el flujo del
    IFS en el período elegido (se puede apagar; respeta
    `prefers-reduced-motion`).
  - Línea de tiempo de 6 en 6 horas hasta 4 días, leyenda con gradiente,
    lectura del valor al tocar el mapa y respaldo automático por capas:
    imágenes mundiales del robot → rejilla regional del robot →
    Open-Meteo (siempre con `models=ecmwf_ifs025`), con caché persistente
    y enfriamiento tras un 429.
- **Frentes del análisis de superficie** (NOAA/WPC, producto observacional,
  no un modelo): líneas de frentes con sus picos + centros H/L.
- Las capas de **satélite GOES/mosaico mundial y radar MRMS** propias
  están **dormidas** a la espera de la decisión sobre imaginería
  observacional bajo la regla solo-ECMWF (Fase 2 del plan global); sus
  pipelines siguen publicando datos.
- **Mapa profesional con MapLibre GL** (renderizado por GPU): paneo y
  zoom fluidos con zoom fraccional, estilo vectorial oscuro de
  **OpenFreeMap** (gratis e ilimitado; CARTO GL como respaldo
  automático), capas de tiempo insertadas **debajo de los rótulos** del
  estilo (los nombres de lugares siempre se leen), radar y satélite
  animados al abrirse, y escala de distancias.
- **Pronóstico puntual 100 % ECMWF** vía Open-Meteo
  (`models=ecmwf_ifs025`): condiciones actuales, próximas 24 horas y
  7 días, en las unidades elegidas. Lo que el IFS no publica se muestra
  como «—» (sin datos), nunca un valor inventado.
- **Riesgos y advertencias severas** (panel izquierdo): evaluación de las
  próximas 48 h del punto activo en cuatro frentes — **viento** (ráfagas;
  extremo = fuerza de huracán ≥ 118 km/h), **lluvia** (acumulados de 6 h;
  extremo ≥ 50 mm, inundaciones repentinas), **tormentas** (códigos de
  tormenta del pronóstico + energía CAPE) y **aire** (índice AQI del
  CAMS). Cada riesgo se clasifica Bajo/Moderado/Alto/Extremo con su
  medidor; los niveles Alto y Extremo generan **AVISOS y ADVERTENCIAS**
  con instrucciones de seguridad en español claro.
- **Buscador de lugares** (geocodificador de Open-Meteo, en español).
- **Ajustes por usuario**: país principal, °C/°F, km/h/mph y capa inicial.
  Siempre se guardan en el dispositivo (`localStorage`); si la cuenta no es
  anónima también se sincronizan en Firestore (`users/{uid}`) para llevarlos
  a cualquier dispositivo.

Todos los servicios del mapa y del pronóstico son **gratuitos y sin clave**
(OpenFreeMap, CARTO como respaldo del estilo, Esri World Imagery,
Open-Meteo, GeoNames).

## Datos propios (robot de GitHub Actions, repo `fenomenos-datos`)

Para no depender de APIs de terceros a gran escala, el repo público
`fenomenos-datos` procesa datos ABIERTOS oficiales y los publica como
archivos estáticos:

- **ECMWF** (`scripts/build_model_data.py` + `modelos.yml`, 4×/día):
  IFS determinista + EPS de 51 escenarios desde AWS Open Data → mapa
  mundial en imágenes webp pre-proyectadas (det viento/ráfagas/lluvia +
  probabilidades, 16 períodos) + rejillas JSON regionales de respaldo.
  La app comprueba `modelos/meta.json` y `modelos/ecmwf/mapa.json`: si
  hay datos frescos (<12 h) los usa — **cero llamadas a APIs por
  usuario, a cualquier escala** — y si faltan cae sola a Open-Meteo
  (siempre `models=ecmwf_ifs025`).
- Los pipelines de **NOAA GFS/GEFS, GEM/GEPS y AIFS** siguen publicando
  sus JSON pero la app ya no los consume (regla solo-ECMWF); su retiro
  definitivo está propuesto en `AUDIT.md`.
- **Observacionales** (GOES-19, mosaico mundial GMGSI, radar MRMS,
  frentes WPC, índice de ciudades GeoNames): publican cada 10 min/hora/
  mes; hoy la app solo consume frentes y ciudades.

**A gran escala** (cientos de miles de usuarios): sirve el sitio detrás
de un CDN con tráfico ilimitado gratis; el mapa y el modelo ya no
dependen de servicios con cuota por usuario.

> ⚠️ **Las cuentas de la app NO entran al Estudio.** El Estudio solo abre
> para las cuentas listadas en la colección `admins` de Firestore (ver
> abajo); cualquier otra sesión —incluidos los invitados— es rechazada con
> «Esta cuenta no tiene acceso al Estudio», y las reglas de Firestore
> refuerzan lo mismo del lado del servidor.

## Puesta en marcha de Firebase (una sola vez)

En la [consola de Firebase](https://console.firebase.google.com/) del proyecto
`fenomenos-61255`:

1. **Authentication → Sign-in method**: habilita **Correo electrónico/contraseña**
   (para el Estudio y las cuentas de la app) y **Anónimo** (para el modo
   invitado de la app).
2. **Authentication → Users → Add user**: crea el usuario del dueño (ese
   correo/contraseña es el acceso al Estudio).
3. **Firestore Database → Data**: crea la colección **`admins`** y añade un
   documento cuyo **ID sea el UID del dueño** (cópialo de Authentication →
   Users). El contenido puede ser algo como `{ role: "owner" }`; lo que
   importa es que el documento exista. **Solo los UID listados aquí pueden
   entrar al Estudio y publicar.** Nunca des permisos de escritura a esta
   colección desde las reglas: se administra solo desde la consola.
4. **Authentication → Settings → Authorized domains**: añade el dominio donde
   está publicado el sitio (p. ej. `usuario.github.io` o tu dominio propio).
5. **Firestore Database**: crea la base de datos (modo producción) y pega estas
   reglas en **Rules**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // ¿La sesión es de un administrador (dueño del Estudio)?
       // Solo los UID con documento en la colección admins/ lo son.
       function isAdmin() {
         return request.auth != null
           && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
       }

       // Lista de administradores: cada quien puede comprobar SOLO su propio
       // documento (así el Estudio verifica el permiso); nadie escribe aquí
       // desde el cliente — se administra desde la consola de Firebase.
       match /admins/{uid} {
         allow get: if request.auth != null && request.auth.uid == uid;
         allow list: if false;
         allow write: if false;
       }

       // Ajustes de la app: cada usuario lee y escribe únicamente los suyos.
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }

       // Artículos: el público solo lee lo publicado; escribir es cosa de
       // administradores — salvo las reacciones (👍 ❤️ 🔥), que cualquiera
       // puede actualizar en artículos publicados (y SOLO ese campo)
       match /articles/{id} {
         allow read: if resource.data.status == 'published' || isAdmin();
         allow create, delete: if isAdmin();
         allow update: if isAdmin()
           || (resource.data.status == 'published'
               && request.resource.data.diff(resource.data).affectedKeys()
                    .hasOnly(['reactions']));
       }

       // Lista de etiquetas y categorías: lectura pública, escritura de admins
       match /meta/{id} {
         allow read: if true;
         allow write: if isAdmin();
       }

       // Comentarios: cualquiera puede crear uno PENDIENTE (con campos
       // válidos); el público solo lee aprobados; los «me gusta» son el
       // único campo que un visitante puede tocar; aprobar/eliminar es
       // cosa de administradores (el Estudio)
       match /comments/{id} {
         allow read: if resource.data.status == 'approved' || isAdmin();
         allow create: if isAdmin() || (
           request.resource.data.status == 'pending'
           && request.resource.data.likes == 0
           && request.resource.data.text is string
           && request.resource.data.text.size() > 0
           && request.resource.data.text.size() <= 2000
           && request.resource.data.name is string
           && request.resource.data.name.size() > 0
           && request.resource.data.name.size() <= 80
           && request.resource.data.depth is int
           && request.resource.data.depth >= 0
           && request.resource.data.depth <= 2
         );
         allow update: if isAdmin() || (
           resource.data.status == 'approved'
           && request.resource.data.diff(resource.data).affectedKeys()
                .hasOnly(['likes'])
         );
         allow delete: if isAdmin();
       }
     }
   }
   ```

Datos en Firestore: colección `articles` (un documento por artículo, con
`title`, `tag`, `excerpt`, `cover`, `footer`, `sections[]`, `status`,
`createdAt/updatedAt/publishedAt`), documento `meta/tags` (etiquetas y
categorías), colección `comments`, colección `users` (ajustes de la app,
un documento por cuenta) y colección `admins` (la lista blanca del Estudio,
administrada desde la consola).

**Nota sobre imágenes**: las imágenes subidas se comprimen en el navegador y se
guardan dentro del propio documento del artículo (límite ~1 MB por artículo; el
Estudio avisa si se supera). Para artículos con muchas imágenes, usa imágenes
por URL o conecta Firebase Storage más adelante.

## Paleta

| Token         | Hex       | Uso                                    |
| ------------- | --------- | -------------------------------------- |
| `--brand`     | `#000b33` | Azul de marca (theme-color de la web)  |
| `--brand-500` | `#172554` | Paneles, hovers                        |
| `--brand-600` | `#121e43` | Vidrio del header                      |
| `--bg`        | `#00060f` | Fondo más profundo                     |
| `--surface`   | `#070b19` | Bandas de sección, celdas de la malla  |
| `--surface-2` | `#090f22` | Fondo del hero                         |
| `--glow`      | `#455176` | Haces de luz del hero                  |
| `--alert`     | `#ffb020` | **Único acento**: señales "en vivo"     |

Todo se controla desde `:root` en `css/style.css`.

## Qué falta conectar

- **Formulario de alertas** (`js/script.js`, sección 6): valida el correo y
  muestra el mensaje de éxito, pero no lo envía a ningún lado todavía. Apúntalo
  a Mailchimp, Brevo, o una Cloud Function de Firebase. Busca el `TODO:`.
- **Enlaces de comunidad**: Messenger, WhatsApp y Telegram apuntan todos a
  `chat.fenomenosdelcaribe.org`. Cámbialos por las URLs reales de cada canal.
- **Páginas de herramientas**: mapas, radares, pronósticos y modelo europeo
  apuntan por ahora a `proximamente.html`, listas para sustituirse por páginas
  propias.

## Notas técnicas

- `html { font-size: 62.5% }` → **1rem = 10px**. Todas las medidas en `rem`.
- Mobile-first: los `@media` son todos `min-width` (36em / 48em / 64em).
- Las páginas públicas leen Firestore **solo con `where` de igualdad** y
  ordenan en el cliente, así no hace falta crear índices compuestos.
- El contenido de los artículos se renderiza siempre como nodos de texto
  (nunca `innerHTML`), de modo que lo almacenado no puede inyectar HTML.
- Las animaciones respetan `prefers-reduced-motion`; si el JS no carga, el
  contenido igual se ve.
