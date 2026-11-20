# Auditoría de cierre P0

Fecha: 2026-11-20  
Rama: `codex/p0-ssr-sitemap`  
Commits locales: `5f2a8ed` (automatización SSR) y `e45af6b` (dominio objetivo). El árbol de trabajo está limpio; ninguno se ha subido.

## Resultado ejecutivo

La rama contiene prerenderizado reproducible para los 20 artículos publicados observados. Ahora incluye un workflow de GitHub Actions programado cada 15 minutos y manual para converger desde Firestore; su ejecución efectiva depende de que GitHub permita `contents: write`.

El generador ahora limpia directorios generados obsoletos, conserva la última salida válida ante fallos, bloquea ejecuciones concurrentes y escribe redirecciones 301 cuando cambia un slug. El flujo fue probado en copias aisladas para cambio de slug y eliminación.

## Verificaciones

| Área | Resultado |
|---|---|
| Idempotencia | PASS; regenerar desde `data/published-articles.json` no cambió hashes de salida |
| Entrada inválida | PASS; rechaza un publicado sin título/cuerpo antes de escribir salidas |
| Artículos SSR | PASS; 20/20 rutas, HTML inicial, schema y canonical |
| Índice y sitemap | PASS local para las 20 rutas nuevas |
| Archivo histórico | PASS estructural; 171 entradas, 2 con menos de 300 palabras, 3 sin autor, sin duplicados exactos ni pares con similitud conservadora >= 0.8 |
| App, consentimiento, tienda y fallback | PASS; 11 pruebas Node y 3 pruebas Python |
| HTTP actual | PASS para `404` inexistente y `200` del archivo en `fenomenosdelcaribe.org`; las nuevas rutas aún devuelven `404` porque no se desplegaron |
| Dominio objetivo | Preparado localmente para `fenomenosmedia.org`; el handshake TLS externo sigue bloqueado hasta configurar hosting/DNS |
| Móvil | PARCIAL; hay viewport meta y CSS responsive, pero no se pudo completar una sesión visual emulada a 360/390/768 px en este entorno |

## Inventario editorial

- Firestore publicado observado: 20 artículos.
- Los 20 carecen de `author` y de `sources`/`source`; el generador no inventa esos campos.
- Archivo histórico: 171 artículos; 3 sin autor y 2 sin portada.
- El análisis local no encontró títulos duplicados, cuerpos idénticos ni pares de alta similitud textual.
- Esto no sustituye una revisión humana de originalidad, licencias, precisión o valor diferencial.

## Dominio y metadatos

La rama mantiene requisitos de lanzamiento que deben validarse en el dominio definitivo:

- `robots.txt`, sitemap, canonicals y metadatos desplegables ya declaran `fenomenosmedia.org`.
- El dominio anterior queda únicamente en documentación, herramientas de migración y referencias históricas no desplegables.
- `ads.txt` conserva el publisher declarado; debe validarse en el dominio objetivo después del despliegue.

No se modificó producción, DNS, Blogger, Huracanes Caribe ni AdSense.

## Bloqueos para cerrar P0

1. Obtener acceso de escritura a GitHub y confirmar que Actions puede usar `contents: write`.
2. Completar autoría y fuentes verdaderas en los 20 documentos Firestore; no rellenar por inferencia.
3. Validar visualmente 360, 390 y 768 px en el entorno de hosting.
4. Configurar DNS/TLS de `fenomenosmedia.org` y repetir las comprobaciones HTTP desde fuera del entorno local.

## Reproducción

```bash
python3 scripts/publish_firestore_articles.py
python3 scripts/test_ssr_publication.py
python3 scripts/test_initial_articles.py
node --test scripts/test_article_fallback.cjs scripts/test_consent.cjs scripts/test_shop.mjs
python3 scripts/test_shop_catalog.py
python3 scripts/adsense_readiness_check.py
git diff --check
```
