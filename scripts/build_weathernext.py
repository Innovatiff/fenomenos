#!/usr/bin/env python3
"""
FENÓMENOS DEL CARIBE — build_weathernext.py

WeatherNext (Google DeepMind) desde BigQuery. El dato llega por la
suscripción gratuita de Analytics Hub del dueño del proyecto; este script
corre en GitHub Actions con una cuenta de servicio (secret GCP_SA_KEY).

MODO SONDEO (actual): sin transformar nada todavía, lista los datasets
"weathernext" accesibles, sus tablas y esquemas, y una fila de muestra.
Con esa salida se escribe la consulta definitiva que producirá
data/modelos/wn/det.json con la misma forma que los demás centros.

Sin credenciales configuradas sale limpio (exit 0) explicando qué falta.
"""

import json
import os
import sys


def log(*a):
    print(*a, flush=True)


def main():
    project = os.environ.get("GCP_PROJECT", "").strip()
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not project or not creds or not os.path.exists(creds):
        log("WeatherNext aún sin configurar: faltan los secrets GCP_PROJECT")
        log("y/o GCP_SA_KEY del repositorio. Pasos: crear proyecto en Google")
        log("Cloud, suscribirse a WeatherNext en Analytics Hub, crear cuenta")
        log("de servicio con BigQuery User + Data Viewer, y guardar su clave")
        log("JSON como secret GCP_SA_KEY (y el ID del proyecto como GCP_PROJECT).")
        sys.exit(0)

    from google.cloud import bigquery

    client = bigquery.Client(project=project)
    log(f"proyecto: {project}")

    found = []
    for ds in client.list_datasets():
        did = ds.dataset_id
        if "weathernext" in did.lower() or "weather_next" in did.lower():
            found.append(did)
    log(f"datasets weathernext: {found or 'NINGUNO (¿falta la suscripción de Analytics Hub?)'}")

    for did in found:
        try:
            tables = list(client.list_tables(did))
        except Exception as ex:
            log(f"  [{did}] no se pudieron listar tablas: {ex}")
            continue
        log(f"  [{did}] tablas: {[t.table_id for t in tables][:10]}")
        for t in tables[:3]:
            try:
                tbl = client.get_table(f"{project}.{did}.{t.table_id}")
                log(f"  ── {t.table_id} · {tbl.num_rows} filas")
                for f in tbl.schema:
                    sub = ""
                    if f.field_type == "RECORD":
                        sub = " { " + ", ".join(
                            f"{sf.name}:{sf.field_type}" for sf in f.fields[:24]
                        ) + " }"
                    log(f"     {f.name}: {f.field_type} ({f.mode}){sub}")
                # una muestra pequeña: solo columnas escalares para no inundar
                scalars = [f.name for f in tbl.schema if f.field_type != "RECORD"][:8]
                if scalars:
                    q = (
                        f"SELECT {', '.join(scalars)} "
                        f"FROM `{project}.{did}.{t.table_id}` LIMIT 2"
                    )
                    for row in client.query(q).result():
                        log("     muestra:", json.dumps(dict(row), default=str)[:300])
            except Exception as ex:
                log(f"  ── {t.table_id} error: {ex}")

    log("sondeo completo")


if __name__ == "__main__":
    main()
