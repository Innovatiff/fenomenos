# Migration Audit

Auditor de solo lectura para la migración Blogger → Fenómenos. Requiere Python 3.10+ y curl; no instala dependencias. Lee directamente el feed Atom original, el catálogo y los HTML existentes. No invoca el generador ni modifica producción.

Desde la raíz del repositorio:

```bash
python3 scripts/migration_audit.py --refresh
python3 scripts/migration_audit.py --offline
python3 scripts/test_migration_audit.py
```

El valor predeterminado de `--source` es `../blogger-migration/source.atom`. Puede indicarse otro respaldo Atom:

```bash
python3 scripts/migration_audit.py --source /ruta/privada/feed.atom --output /ruta/privada/migration-audit --preview-base http://127.0.0.1:8768 --refresh
```

La vista previa debe estar sirviendo este repositorio. Si está detenida, el auditor registra el fallo de HTTP local: no lo confunde con ausencia del archivo. El dominio público se comprueba aparte. Una ejecución normal reutiliza las respuestas guardadas; `--refresh` renueva la evidencia. `--offline` no realiza consultas nuevas; cada respuesta conserva su fecha.

Resultados: JSON completo, CSV de inventario y tablas auxiliares, Markdown para PM y caché HTTP. El destino predeterminado está fuera del repositorio público, en `outputs/migration-audit`. No publicar estos reportes ni el respaldo original: incluyen inventario y asociaciones internas de comentarios. Los comentarios no se exportan con texto o identidad del autor.

HTTP: GET de HTML, HEAD de imágenes y GET con rango 0–1023 para contrastar 404/410. Si un origen ignora Range, curl limita la transferencia a 64 KiB. No se conservan payloads de imágenes. No se prueban escrituras ni se ejecutan scripts de terceros.

Clasificación: FAIL indica ausencia de destino, fallo de canonical/indexación o imagen principal rota confirmada, entre otros errores; WARNING incluye revisiones editoriales y campos opcionales de schema. El informe distingue estado local y público. Un WARNING no equivale a una infracción de AdSense.

EXTERNAL_STABLE queda reservado: una única respuesta HTTP satisfactoria no prueba estabilidad futura. Las imágenes externas accesibles se clasifican EXTERNAL_DEPENDENCY; DNS/timeout como UNKNOWN; solo un 404/410 contrastado con GET se clasifica BROKEN. Las coincidencias de nombre con el álbum local no se presentan como copias verificadas.
