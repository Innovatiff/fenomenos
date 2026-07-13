# Fenómenos del Caribe — sitio web

Landing page terminada, **mobile-first**, construida sobre el diseño original
(vidrio azul profundo, bordes de gradiente, tipografía Gugi, malla del hero con
haces de luz y el marquee). Contenido tomado de
[fenomenosdelcaribe.org](https://fenomenosdelcaribe.org/).

## Estructura

```
fenomenos-del-caribe/
├── index.html          ← una sola página, todas las secciones
├── css/
│   └── style.css       ← un solo archivo CSS
├── js/
│   └── script.js       ← un solo archivo JS (vanilla, sin dependencias)
└── img/
    ├── logo.png            (header + footer)
    ├── favicon.png
    ├── apple-touch-icon.png
    └── favicon.jpeg        (original, por si lo necesitas)
```

Súbelo tal cual a Netlify, Vercel, GitHub Pages o cualquier hosting estático.
No hay build step.

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

Todo se controla desde `:root` en `css/style.css`. Cambia un token y cambia
todo el sitio.

## Secciones

1. **Header** — píldora de vidrio, dropdown "Datos y mapas", drawer en móvil
2. **Hero** — malla + haces de luz animados, píldora de estado en vivo, stats
3. **Fuentes** — marquee infinito (NHC, NWS, NOAA, SMN, INSIVUMEH, INDOMET)
4. **Misión** — 4 pilares
5. **Cobertura de fenómenos** — Huracanes Caribe, Tiempo Severo Caribe,
   Terremotos Caribe, Fenómenos USA
6. **Servicios** — alertas localizadas, mapas, seguimiento, análisis
7. **Cobertura regional** — 12 países
8. **Comunidad** — chat en vivo + canales
9. **Artículos** — 4 más populares
10. **Alertas** — formulario de suscripción
11. **Footer**

## Qué falta conectar

- **Formulario de alertas** (`js/script.js`, sección 6): valida el correo y
  muestra el mensaje de éxito, pero no lo envía a ningún lado todavía. Apúntalo
  a Mailchimp, Brevo, o una Cloud Function de Firebase. Busca el `TODO:`.
- **Imágenes remotas**: las miniaturas de artículos y los logos de las marcas
  cargan desde `fenomenosdelcaribe.org`. Si mueves el sitio, descárgalas a
  `img/` y cambia los `src`. Si una falla, el JS la reemplaza por un ícono.
- **Enlaces de comunidad**: Messenger, WhatsApp y Telegram apuntan todos a
  `chat.fenomenosdelcaribe.org`. Cámbialos por las URLs reales de cada canal.

## Notas técnicas

- `html { font-size: 62.5% }` → **1rem = 10px**. Todas las medidas en `rem`.
- Mobile-first: los `@media` son todos `min-width` (36em / 48em / 64em).
- **Titular a medida.** El H1 son dos líneas que nunca se parten
  (`.hero__heading--line`). `script.js` mide la línea más larga y escala el
  tipo para que llene la columna de borde a borde en cualquier ancho — y lo
  vuelve a hacer cuando Gugi termina de cargar. También se limita por la
  altura de la ventana, para que la franja de datos no quede cortada en
  portátiles bajos. Si cambias el texto del H1, el tamaño se recalcula solo.
- **Nav del teléfono.** Es un *dropdown* que cuelga del header, no una pantalla
  completa: solo mide lo que mide su contenido y el fondo se ve detrás.
- La malla del hero se genera en JS y se reconstruye al rotar el teléfono, así
  que encaja en cualquier pantalla en vez de tener cientos de `<div>` fijos.
- Las animaciones respetan `prefers-reduced-motion`.
- Si el JS no carga, el contenido igual se ve (las animaciones de scroll están
  bajo la clase `.js`).
