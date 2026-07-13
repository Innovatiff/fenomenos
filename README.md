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
├── estudio.html        ← ⚠ EL SOFTWARE (privado): crear/editar/publicar artículos
├── css/
│   ├── style.css       ← base del sitio (tokens, header, cards, footer…)
│   ├── articles.css    ← páginas públicas de artículos + próximamente
│   └── estudio.css     ← estilos del Estudio
├── js/
│   ├── script.js       ← interacción general (header, malla, reveals…)
│   ├── firebase-init.js← configuración e inicialización de Firebase
│   ├── db.js           ← lecturas públicas de Firestore
│   ├── render-article.js ← renderizador compartido (público + vista previa)
│   ├── index-articles.js ← últimos artículos en portada
│   ├── articles-page.js  ← listado con filtros y búsqueda
│   ├── article-page.js   ← lector de artículo
│   └── estudio.js        ← toda la lógica del Estudio
└── img/                ← logo, favicons
```

Sin build step. Súbelo tal cual a GitHub Pages, Netlify o Vercel.

## El Estudio de publicación (`estudio.html`)

Página **sin enlaces desde el sitio**: solo se entra escribiendo la URL
(`https://tudominio/estudio.html`). Requiere iniciar sesión con **Firebase
Authentication** (correo y contraseña).

Qué permite:

- **Crear artículos** con título, etiqueta (desplegable), resumen, imagen de
  portada (URL o subida con compresión automática) y pie de artículo.
- **Contenido por secciones**: subtítulos, párrafos, imágenes, citas y listas.
  Las secciones se **reordenan arrastrando** el asa (o con los botones ↑ ↓).
- **Guardar borrador / Publicar**: al publicar, el artículo aparece al instante
  en `articulos.html` y en la portada.
- **Editar y eliminar** artículos existentes, y **despublicar** (volver a
  borrador) desde el listado.
- **Gestor de etiquetas**: la lista que alimenta el desplegable del editor y
  los filtros de la página pública. (Pensadas para tener páginas propias por
  etiqueta más adelante.)
- **Vista previa** 1:1 con la página pública antes de publicar.

## Puesta en marcha de Firebase (una sola vez)

En la [consola de Firebase](https://console.firebase.google.com/) del proyecto
`fenomenos-61255`:

1. **Authentication → Sign-in method**: habilita **Correo electrónico/contraseña**.
2. **Authentication → Users → Add user**: crea el usuario del dueño (ese
   correo/contraseña es el acceso al Estudio). No hay registro público.
3. **Authentication → Settings → Authorized domains**: añade el dominio donde
   está publicado el sitio (p. ej. `usuario.github.io` o tu dominio propio).
4. **Firestore Database**: crea la base de datos (modo producción) y pega estas
   reglas en **Rules**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       // Artículos: el público solo lee lo publicado; escribir requiere sesión
       match /articles/{id} {
         allow read: if resource.data.status == 'published' || request.auth != null;
         allow write: if request.auth != null;
       }
       // Lista de etiquetas: lectura pública, escritura con sesión
       match /meta/{id} {
         allow read: if true;
         allow write: if request.auth != null;
       }
     }
   }
   ```

Datos en Firestore: colección `articles` (un documento por artículo, con
`title`, `tag`, `excerpt`, `cover`, `footer`, `sections[]`, `status`,
`createdAt/updatedAt/publishedAt`) y documento `meta/tags` (la lista de
etiquetas).

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
