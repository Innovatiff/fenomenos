# Publicación SSR de artículos

Los artículos publicados se generan desde la consulta filtrada `status == published` de Firestore. El generador escribe una página completa en `articulos/<slug>/index.html`, el manifiesto que usa la capa interactiva, el índice y el sitemap. No publica datos nuevos en Firestore ni despliega el sitio.

`.github/workflows/publish-firestore-articles.yml` ejecuta el mismo generador manualmente o cada 15 minutos. La ejecución usa un bloqueo local, tres intentos de lectura, conserva la última salida válida si falla, elimina solo rutas generadas obsoletas y produce redirecciones 301 para slugs cambiados. El workflow hace commit únicamente si cambió la publicación.

```bash
python3 scripts/publish_firestore_articles.py
```

Para una ejecución reproducible sin red:

```bash
python3 scripts/publish_firestore_articles.py --source-json /ruta/a/published-articles.json --origin https://fenomenosmedia.org
```

Los artículos sin título o cuerpo se rechazan; autor y fuentes solo se muestran cuando existen explícitamente en el documento. Las rutas históricas del archivo (`/2016/...`, etc.) permanecen intactas.
