# Tienda oficial de Fenómenos Media — integración y validación

Estado: integración autorizada para publicar en main el 27 de septiembre de 2026.
Comprobados producto, talla, cesta y acceso al checkout. No se efectuó un pago.
No se afirma que el proceso de compra completo ni Tracking estén validados.

## 1. Dominio e identidad

Dominio: https://fenomenos-media.myspreadshop.com
Nombre configurado: `fenomenos-Media`; ID: `1976125`.
El propietario confirmó `.com`. El navegador mostró inicialmente «This Shop is not
active»; después de que el propietario la activara, cargó «Fenómenos Media Shop».
Su enlace de privacidad contiene `shop_id=1976125&platform=na`. El script oficial
`/js/shopclient.nocache.js` renderizó la tienda dentro de la página local.
Las peticiones curl al proveedor devolvieron 403; la comprobación funcional se
realizó en navegador. No se deduce disponibilidad del proveedor de ese curl.

## 2. Archivos creados

- `tienda/index.html`: página pública y contenedor `#shop`.
- `css/shop.css`: presentación del marco de la tienda.
- `css/shop-shell.css`: copia generada de los estilos compartidos, solo para tienda.
- `js/shop-config.js`: configuración del dominio verificado, nombre e interruptor.
- `js/shop.js`: cargador oficial, estado inicial, error y fallback.
- `js/shop-metadata.js`: preservación de metadata del sitio anfitrión.
- `scripts/build_shop_shell.py`: generador del CSS de tienda.
- `scripts/test_shop.mjs`: pruebas del cargador y sus estados de fallo.
- Este documento.

## 3. Archivos modificados

- `index.html`: enlace Tienda estático en los menús desktop y móvil.
- `js/script.js`: añade Tienda al resto de las cabeceras públicas compartidas sin
  duplicarla. Excluye app, acceso, estudio, radar y próximamente. No reescribe
  documentos de artículos ni sus URLs.
- `p/privacy.html`: sección sobre Spreadshop y vínculo al proveedor.
- `sitemap.xml`: añade exclusivamente `/tienda/`.

No se han cambiado Firebase, archivos de Fenómenos App, datos meteorológicos,
artículos, migración, redirecciones ni herramientas.

## 4. URL final

https://fenomenosdelcaribe.org/tienda/
Vista local: http://127.0.0.1:8770/tienda/
La carpeta contiene index.html; no requiere rewrite nuevo ni cambios de 301.
HTTP 200 comprobado localmente. HTTP público pendiente del despliegue.

## 5. Menús

Tienda apunta a `/tienda/`, no al proveedor. Verificados enlace desktop y apertura,
navegación y cierre del menú móvil. La tienda conserva cabecera y pie de la portada,
con rutas absolutas para imágenes, enlaces y scripts. El enlace externo es fallback.

## 6–7. Desktop y móvil

Probado desktop (1280 y aproximadamente 1575 px) y móvil (390 px): sin overflow
horizontal de página en las vistas inicial, catálogo vacío y cesta vacía.
Contenedor amplio, hasta 1440 px; conserva fondo navy, Inter y acentos dorados.
La tienda real conserva de momento su tema blanco/rojo y textos en inglés.

Spreadshop usa rem asumiendo raíz de 16 px; Fenómenos usa raíz de 10 px. Se resolvió
sin tocar CSS interno del proveedor: el generador convierte rem del marco original
a px equivalentes y solo en /tienda/ deja la raíz en 16 px. Regenerar con
`python3 scripts/build_shop_shell.py` cuando cambien style.css o brand.css.
El texto del menú del proveedor pasó de 10 a 16 px en la comprobación del navegador.

La cabecera fija tapaba el cierre del menú móvil de Spreadshop. Una regla :has()
oculta solamente la cabecera de Fenómenos mientras `.sprd-burgermenu--open` está
presente; reaparece al cerrar. Apertura/cierre verificados. Esta clase externa es
una dependencia que se debe revisar si cambia el proveedor. No se sobrescriben
los componentes internos ni sus colores.

Configurar colores internos desde el panel de Spreadshop: navy #000b33, dorado
#F4C542, blanco #FFFFFF y texto con contraste adecuado. No se han cambiado ajustes
de la cuenta ni inventado un locale. `locale` se omite para respetar idioma/moneda
del shop NA; `es_MX` no aparece entre opciones documentadas. No se fuerza un locale
EU ni una moneda distinta para obtener traducción al español.

## 8. Consola

No aparecieron errores ni warnings en las consultas del navegador local después
de cargar la integración y abrir la cesta. Esto no valida todos los dispositivos
ni las pantallas todavía inaccesibles sin productos.

## 9. Productos y checkout

El catálogo muestra 16 productos del diseño. Comprobados camiseta, talla M,
añadir a cesta y subtotal $26.99 + envío provisional $6.49 = $33.48. El checkout
externo abrió con el mismo producto y formulario de envío. No se introdujeron datos
personales o de pago ni se realizó una compra. Pago y creación de pedido no probados.
En móvil de 390 px, cesta y checkout inicial sin desbordamiento horizontal;
selector de color cambia visualmente de mint a royal blue.

Los metadatos del diseño se corrigieron y guardaron en Spreadshop:
«Huracanes Caribe — Logo oficial», descripción en español y siete etiquetas relevantes.
No requieren cambios Git. Checkout vuelve a la tienda externa del proveedor.

República Dominicana no figura en los 182 destinos del selector Country comprobado
el 27 de septiembre de 2026. Dominica (DM) sí figura y es otro país. No anunciar envío
directo a RD sin confirmación del proveedor. No se verificaron destinos mediante pedidos.

## 10. Privacidad y consentimiento

El cargador de Spreadshop solo se incluye en /tienda/. No se añadieron GA4/AdSense
ni se modificó la CMP existente; tampoco se presupone que Google gestione este
proveedor. La nueva página no incorpora scripts de publicidad/analítica propios.
Esto no garantiza ausencia de analítica del proveedor.

La política enlazada por la tienda declara datos técnicos, cookies de sesión,
persistentes y de terceros; describe analítica, publicidad y proveedores de pago.
Son declaraciones generales del proveedor, no una auditoría de cookies efectivas
de esta tienda. El botón Tracking está visible; en la prueba no abrió controles
visibles, por lo que no se considera validada la retirada de consentimiento.
No se configuró ningún pixel adicional.

El propietario debe revisar configuración de Tracking, proveedores opcionales,
comportamiento con aceptación/rechazo y la relación con la CMP antes de producción.
Si se necesita consentimiento previo específico, conectar su señal confirmada al
cargador o implantar un bloqueo explícito; no reutilizar a ciegas analytics_storage.
No se afirma cumplimiento legal. Nueva sección de privacidad local lista para revisión.

Fuentes consultadas:
- https://help.spreadshop.support/hc/en-us/articles/360010529039-Website-Integration-with-JavaScript
- https://service.spreadshirt.com/hc/en-us/articles/115000978409-Privacy?platform=na&shop_id=1976125&shop_name=fenomenos-Media

## 11. Metadata

Canonical único: https://fenomenosdelcaribe.org/tienda/
Title: Tienda oficial | Fenómenos Media
Description: Descubre la tienda oficial de Fenómenos Media, con productos de nuestra
comunidad a través de Spreadshop.
OG title/url/description/image y Twitter summary controlados por Fenómenos.
Robots: index, follow. robots.txt permite rastreo. Sitemap incorpora la tienda.

`updateMetadata:false`; `usePushState:false`; navegación estándar con hash.
Se observó que la cesta cambiaba el título a «Shopping cart» aun con metadata false.
`shop-metadata.js` conserva los nodos SEO originales y retira duplicados de esos
campos: comprobados title, canonical único, description y robots en cesta después
de corregirlo. No se proponen URLs canónicas individuales de productos hash.

## 12. Fallback

«Visitar tienda» apunta únicamente al dominio verificado, con target=_blank y
rel="noopener noreferrer". Click comprobado: abre la tienda en otra pestaña.
Permanece disponible incluso con embed cargado para fallos posteriores del proveedor.
En error de script, muestra mensaje claro y Reintentar. En carga lenta, conserva
el escape a los 20 s sin desmontar una tienda que llegue tarde. No cambia el
mensaje de carga después de que el proveedor monte su interfaz.
Con JavaScript desactivado hay enlace directo en noscript.

## 13. Pruebas y siguiente paso

- `node --test scripts/test_shop.mjs`: 4 pruebas pasan (dominio desautorizado/desactivación,
  parámetros, error de script, carga lenta/recuperación tardía).
- `node --check` en shop.js, shop-config.js, shop-metadata.js y script.js.
- HTML: canonical único, robots, ambos enlaces Tienda, seguridad del fallback.
- XML sitemap parseado; robots.txt revisado; CSS generado reproducible.
- Navegador: embed real, hash navigation, menús, cesta vacía, fuentes, scroll,
  ancho móvil/desktop, metadata, fallback externo; consola sin errores observados.
- `git diff --check`.
- Evidencia fuera del repositorio: outputs/shop/desktop.png y mobile.png.

Pendientes: revisar Tracking/consentimiento y confirmar estilos/idioma del shop.
El propietario autorizó publicar; no se afirma cumplimiento legal ni pago validado.
Publicar solo los archivos de esta integración; la rama de trabajo contiene además
commits anteriores de modelos NO desplegados que no pertenecen a esta tarea.
