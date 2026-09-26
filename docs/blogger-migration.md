# Migración de Huracanes Caribe

Se integran 171 entradas estáticas con las rutas originales de Blogger. El catálogo de Artículos combina estos registros con Firestore, ordena por fecha y permite buscar y filtrar el archivo. Los documentos y comentarios actuales de Firestore no se modifican.

## Alcance

- Fuente: exportación Blogger suministrada por el propietario. 173 entradas; 171 preparadas.
- Dos pendientes: la entrada sin desarrollo del 14/12/2025 y la guía con enlaces TUENLACE/TULINK.
- Las 42 páginas de herramientas y los 41 comentarios permanecen en el respaldo privado para una fase posterior; dos comentarios están marcados como spam.
- Dos títulos ausentes se recuperaron del texto de sus artículos. Fechas originales conservadas, sin simular una actualización editorial reciente.
- Canonical, Article JSON-LD, metadatos sociales y sitemap para las entradas incluidas.
- AdSense y ads.txt para el editor proporcionado. Esto no constituye aprobación de Google.
- Tipografía compartida de 20–22 px y gris claro #DCE1EA para artículos actuales, archivo y editor.

## Verificación

Ejecutar `python3 tools/verify-blogger-archive.py` desde cualquier directorio.

Se comprobaron 420 URLs de imágenes mediante HEAD: 418 devolvieron 200 con tipo imagen y dos fallaron (DNS/timeout). Las dos referencias fallidas muestran un aviso. Esto no verifica decodificación de todos los archivos ni su disponibilidad futura. Las imágenes continúan alojadas en sus fuentes; no se ha completado la independencia del alojamiento de Blogger.

El catálogo combinado mostró 181 artículos en la sesión de prueba (171 del archivo y 10 publicados en Firestore). Se comprobó búsqueda de «vaguadas». La existencia de más contenido no garantiza resolver el rechazo «Low-value content».

## Regeneración

`python3 tools/build-blogger-archive.py --migration /ruta/al/directorio/privado`

El directorio privado debe contener private-records.json, publication-selection.json, manifest.json, preview y opcionalmente image-http-check.json, preparados desde Takeout. No subir esos respaldos, comentarios, datos de cuenta o temas originales al repositorio o directorio público.

## Publicación y reversión

Este cambio no modifica DNS ni instala redirecciones desde huracanescaribe.com. Revisar el despliegue antes de solicitar revisión de AdSense. Comprobar /ads.txt, /archivo/, artículos, búsquedas, sitemap y estilos en el dominio público. Mantener el sitio Blogger disponible hasta decidir el cambio definitivo.

La política de privacidad, consentimiento aplicable, páginas incompletas y derechos de los recursos externos necesitan resolución antes de considerar lista la monetización. Search Console y AdSense son procesos distintos.

Para revertir esta fase, revertir el commit de migración y volver a desplegar. No requiere restaurar Firestore, porque esta fase no escribe en él. Las redirecciones del dominio antiguo deben prepararse y validarse por separado; no hacer una redirección global a la portada.
