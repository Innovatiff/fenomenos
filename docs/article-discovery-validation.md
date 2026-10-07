# Catálogo inicial: corrección P0

`/articulos` no aportaba enlaces al catálogo en el HTML inicial. El archivo y el sitemap sí ofrecían descubrimiento; esto no demuestra que todos los artículos fueran huérfanos.

## Implementación

- `python3 scripts/render_initial_articles.py` genera 48 artículos reales en `articulos.html` y 4 en `index.html`, desde `archivo/catalog.json`.
- Las fechas originales y la etiqueta Archivo permanecen visibles. Esta base corresponde al archivo local, no a una exportación de las publicaciones recientes de Firebase.
- JavaScript conserva las tarjetas mientras espera fuentes remotas, mezcla las publicaciones recibidas y prepara todas las tarjetas antes de sustituir el contenido en una sola operación.
- No hay watchdog que vacíe la cuadrícula ni skeletons iniciales. La búsqueda sin coincidencias puede mostrar un estado vacío deliberado.
- Regenerar el HTML cuando se actualice el catálogo local. No existe sincronización automática del HTML estático con Firebase.

## Verificado localmente (2026-10-07)

- HTML servido por HTTP: 48 enlaces reales en artículos; pruebas de fuente verifican 4 en portada y destinos locales existentes.
- Generación repetible, sin cambios al ejecutar dos veces.
- Pruebas de módulos con fuentes rechazadas y pendientes: conservan los nodos iniciales en ambas páginas.
- Navegador: 48 tarjetas sin skeletons; tras cargar Firebase, 183 artículos disponibles entre archivo y publicaciones recientes.
- Búsqueda Elsa: tres resultados; limpiar búsqueda y cargar más: 48 tarjetas.
- Portada: cuatro enlaces estáticos presentes en la primera observación del navegador.
- Comandos: `python3 scripts/test_initial_articles.py`, `node --test scripts/test_article_fallback.cjs`, comprobación de sintaxis JS y `git diff --check`.

## Pendiente antes de reenviar a AdSense

No se ha desplegado esta corrección. No reenviar todavía.

1. Comprobar HTML fuente por HTTP de las URLs públicas finales y sus redirecciones.
2. Abrir ambas páginas con JavaScript desactivado y verificar tarjetas y navegación visibles.
3. Simular Firebase bloqueado en navegador: mantener tarjetas, búsqueda y enlaces utilizables. Las pruebas automatizadas locales simulan este fallo, pero no sustituyen esta comprobación en producción.
4. Inspeccionar DOM durante carga lenta: sin estados transitorios vacíos ni skeletons.
5. Search Console, prueba de URL publicada: guardar screenshot y HTML renderizado para artículos y portada; comprobar enlaces reales en ambos.
6. Solo tras completar estas comprobaciones, reconsiderar el reenvío a AdSense. Esta corrección no garantiza aprobación ni indexación.
