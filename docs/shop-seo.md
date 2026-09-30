# Tienda: contenido visible y datos estructurados

Verificación: 29 de septiembre de 2026, tienda de Estados Unidos (USD).

## Catálogo comprobado

- 16 productos del diseño publicado «Huracanes Caribe — Logo oficial ORIG».
- Cada ficha consultada indica `is in stock` e impresión tras el pedido.
- Fuente: https://fenomenos-media.myspreadshop.com/all
- Lista de diseños: https://fenomenos-media.myspreadshop.com/all?listModeOverride=DESIGN
- «Est 2017», huracán con bandera dominicana, no aparece publicado en la lista pública consultada. No se creó ninguna oferta ni descripción comercial para ese diseño.
- `shop-products.csv` conserva nombres originales, traducciones, precios USD, URLs, imágenes y disponibilidad.

## Implementación

`data/shop-catalog.json` alimenta `scripts/render_shop_catalog.py`, que genera conjuntamente las tarjetas HTML visibles y el ItemList de 16 Product/Offer en `/tienda/index.html`. HTML disponible sin JavaScript; ningún contenido depende del user-agent, de ser Googlebot o de visibilidad artificial. Se mantiene el catálogo interactivo de Spreadshop debajo y un enlace de salto arriba.

Título, descripción, H1, introducción y descripción de colección están en español. Todas las imágenes del catálogo tienen alt descriptivo. Canonical: https://fenomenosdelcaribe.org/tienda/. Robots: index, follow; robots.txt permite rastreo y sitemap.xml incluye la URL. La URL pública respondió HTTP 200 sin X-Robots-Tag restrictivo; aún sirve la versión anterior hasta publicar estos cambios.

Precios sin descuentos por código, envío ni impuestos. La página indica moneda, fecha de comprobación y posibles variaciones por talla/personalización. No se han inventado valoraciones, políticas de devolución, gastos de envío ni fecha de expiración de ofertas.

## Validación

Prueba oficial Google Rich Results, modo CÓDIGO con el HTML completo:
https://search.google.com/test/rich-results/result?id=yykTfPRt8Dk6hZEjBOQsOg

- 33 elementos válidos, sin errores críticos.
- 16 fragmentos de productos válidos.
- 16 fichas de comerciantes válidas.
- 1 carrusel válido.
- Avisos no críticos en Product: `aggregateRating` y `review` opcionales ausentes. No se copian valoraciones genéricas de prendas en productos del diseño ni se inventan reseñas.
- Otras modalidades detectadas incluyen recomendaciones opcionales. Validez sintáctica no garantiza elegibilidad editorial, indexación, posicionamiento ni aparición de resultados enriquecidos: las reglas de Google para Product se orientan a páginas de producto específico, mientras esta URL es un catálogo multiproducto.
- Prueba de código, no inspección de la futura URL desplegada. Tras publicar, volver a probar la URL y solicitar indexación en Search Console si procede.

Comprobaciones locales: `python3 scripts/test_shop_catalog.py` (coincidencia exacta entre ofertas, fuente verificada y texto/imágenes/enlaces visibles; unicidad, canonical, robots, sitemap). `git diff --check`.

## Mantenimiento

Los precios son una instantánea verificada, no una sincronización automática. Antes de publicar y cada vez que cambien precios, productos o disponibilidad en Spreadshop:
1. Volver a consultar las fichas públicas en USD y actualizar `data/shop-catalog.json`, incluida `checkedOn` y la evidencia de disponibilidad.
2. Ejecutar `python3 scripts/render_shop_catalog.py` y `python3 scripts/test_shop_catalog.py`.
3. Publicar HTML y datos juntos; volver a ejecutar la prueba de resultados enriquecidos si cambia la estructura.

No hay automatización recurrente configurada. El generador evita que el HTML visible y JSON-LD se editen por separado.
