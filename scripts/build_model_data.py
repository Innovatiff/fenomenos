#!/usr/bin/env python3
"""
FENÓMENOS DEL CARIBE — build_model_data.py

Procesa los datos ABIERTOS de los tres centros mundiales a JSONs ligeros
que Fenómenos App lee como archivos estáticos (cero APIs por usuario):

  · ECMWF  — IFS determinista + ENS (ensemble) · AWS Open Data / data.ecmwf.int
  · NOAA   — GFS determinista + GEFS (ensemble) · AWS Open Data (S3 público)
  · GEM    — GDPS determinista + GEPS (ensemble) · Datamart de ECCC (Canadá)

Salida (data/modelos/):
  meta.json               ← qué centros/corridas están disponibles
  {ecmwf|noaa|gem}/det.json   ← campos por período de 6 h: viento, ráfagas,
                                lluvia + u/v para las partículas animadas
  {ecmwf|noaa|gem}/prob.json  ← % de miembros del ensemble sobre el umbral

Pensado para GitHub Actions (ubuntu-latest) cada 6 horas. Cada centro es
independiente: si uno falla, los demás se publican igual.
"""

import datetime as dt
import json
import math
import os
import sys
import tempfile
import traceback
import urllib.error
import urllib.request

import numpy as np

# ── Región y rejillas ────────────────────────────────────────────────────
# Caribe + México + Centroamérica + sur/este de EE. UU.
LAT_MIN, LAT_MAX = 4.0, 36.0
LON_MIN, LON_MAX = -112.0, -52.0
DET_SP = 0.75   # rejilla determinista (°)
PROB_SP = 1.0   # rejilla de probabilidades (°)

HOURS_MAX = 96          # 4 días
PERIOD = 6              # horas por período
SNAP_STEP = 3           # se muestrea el modelo cada 3 h

# Umbrales de tiempo peligroso (los mismos de la app)
THR_WIND_MPH = 25.0
THR_GUST_MPH = 40.0
THR_RAIN_MM = 25.0

MS_TO_MPH = 2.236936

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "modelos")


def log(*a):
    print(*a, flush=True)


def grid_axes(sp):
    lats = np.arange(LAT_MAX, LAT_MIN - 1e-6, -sp)   # norte → sur
    lons = np.arange(LON_MIN, LON_MAX + 1e-6, sp)    # oeste → este
    return lats, lons


def grid_json(sp):
    lats, lons = grid_axes(sp)
    return {
        "lats": [round(float(x), 3) for x in lats],
        "lons": [round(float(x), 3) for x in lons],
        "sp": sp,
        "key": "static",
    }


def regrid(da, sp):
    """Interpola un DataArray (lat/lon) a nuestra rejilla, como matriz numpy
    con el orden de la app: filas norte→sur, columnas oeste→este."""
    lats, lons = grid_axes(sp)
    lat_name = "latitude" if "latitude" in da.dims else "lat"
    lon_name = "longitude" if "longitude" in da.dims else "lon"
    lon_vals = da[lon_name].values
    if lon_vals.max() > 180:  # 0..360 → −180..180
        da = da.assign_coords({lon_name: (((da[lon_name] + 180) % 360) - 180)})
        da = da.sortby(lon_name)
    da = da.sortby(lat_name)
    out = da.interp({lat_name: lats, lon_name: lons}, method="linear")
    return np.asarray(out.values)


def flat(values_2d):
    return values_2d.reshape(-1)


def q1(x):
    """redondeo a 1 decimal apto para JSON (None si NaN)"""
    return None if x is None or not math.isfinite(x) else round(float(x), 1)


def period_times(run_dt):
    n = HOURS_MAX // PERIOD
    return [int((run_dt + dt.timedelta(hours=PERIOD * i)).timestamp()) for i in range(n)]


def http_get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "fenomenos-app-data/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def http_range(url, start, end, timeout=120):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "fenomenos-app-data/1.0",
            "Range": f"bytes={start}-{end}",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def open_grib(raw_bytes, filter_keys=None):
    """Abre bytes GRIB2 con cfgrib y devuelve el dataset xarray."""
    import xarray as xr

    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as f:
        f.write(raw_bytes)
        path = f.name
    kwargs = {"engine": "cfgrib", "backend_kwargs": {"indexpath": ""}}
    if filter_keys:
        kwargs["backend_kwargs"]["filter_by_keys"] = filter_keys
    try:
        return xr.open_dataset(path, **kwargs)
    finally:
        # cfgrib ya leyó a memoria en .load(); el llamador debe .load()
        pass


# ═════════════════════════ agregación común ══════════════════════════════

def periods_from_snapshots(snaps, mode):
    """snaps: dict paso_horas → matriz aplanada (o None).
    Devuelve lista por período de 6 h agregando los pasos de 3 h.
    mode 'max' usa los snapshots dentro del período (t+3, t+6);
    mode 'diff' espera ACUMULADOS desde el inicio de la corrida y devuelve
    la diferencia acumulado(t+6) − acumulado(t)."""
    out = []
    n = HOURS_MAX // PERIOD
    for i in range(n):
        t0, t1 = i * PERIOD, (i + 1) * PERIOD
        if mode == "max":
            parts = [snaps.get(h) for h in range(t0 + SNAP_STEP, t1 + 1, SNAP_STEP)]
            parts = [p for p in parts if p is not None]
            out.append(np.maximum.reduce(parts) if parts else None)
        else:  # diff de acumulados
            a, b = snaps.get(t0), snaps.get(t1)
            if a is None and t0 == 0:
                a = np.zeros_like(b) if b is not None else None
            out.append((b - a) if (a is not None and b is not None) else None)
    return out


def pack(series, npoints):
    """[período][punto] → [punto][período] con redondeo, para el JSON."""
    n = len(series)
    cols = []
    for p in range(npoints):
        cols.append([
            q1(float(series[s][p])) if series[s] is not None else None
            for s in range(n)
        ])
    return cols


def prob_pack(member_series, threshold, npoints):
    """member_series: lista por miembro de [período][punto] (valores) →
    [punto][período] con % de miembros > umbral."""
    nper = HOURS_MAX // PERIOD
    out = []
    for p in range(npoints):
        row = []
        for s in range(nper):
            vals = [
                m[s][p]
                for m in member_series
                if m[s] is not None and math.isfinite(float(m[s][p]))
            ]
            row.append(round(100.0 * sum(1 for v in vals if v > threshold) / len(vals)) if vals else None)
        out.append(row)
    return out


# ═══════════════════════════════ ECMWF ═══════════════════════════════════

def build_ecmwf(outdir):
    """IFS determinista + ENS vía el cliente oficial de datos abiertos
    (usa los .index para bajar solo los campos pedidos)."""
    from ecmwf.opendata import Client

    steps = list(range(0, HOURS_MAX + 1, SNAP_STEP))
    steps6 = list(range(0, HOURS_MAX + 1, PERIOD))

    client = Client(source="aws")  # bucket de AWS Open Data
    lat_d, lon_d = grid_axes(DET_SP)
    npoints_d = len(lat_d) * len(lon_d)

    # ── determinista (HRES/oper) ──
    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as f:
        det_path = f.name
    res = client.retrieve(
        type="fc", stream="oper", step=steps,
        param=["10u", "10v", "10fg6", "tp"], target=det_path,
    )
    run_dt = dt.datetime.combine(res.datetime.date(), dt.time(res.datetime.hour), dt.timezone.utc)
    log(f"[ecmwf] corrida {run_dt:%Y-%m-%d %Hz} descargada")

    import xarray as xr

    def series_for(short, sp, mode):
        ds = xr.open_dataset(
            det_path, engine="cfgrib",
            backend_kwargs={"indexpath": "", "filter_by_keys": {"shortName": short}},
        ).load()
        var = list(ds.data_vars)[0]
        da = ds[var]
        snaps = {}
        step_dim = "step" if "step" in da.dims else None
        for k in range(da.sizes.get(step_dim, 1)):
            sl = da.isel({step_dim: k}) if step_dim else da
            h = int(sl["step"].values / np.timedelta64(1, "h")) if "step" in sl.coords else 0
            snaps[h] = flat(regrid(sl, sp))
        return periods_from_snapshots(snaps, mode)

    # u/v: para partículas usamos el snapshot de mitad de período (t+3)
    def uv_series(short):
        ds = xr.open_dataset(
            det_path, engine="cfgrib",
            backend_kwargs={"indexpath": "", "filter_by_keys": {"shortName": short}},
        ).load()
        da = ds[list(ds.data_vars)[0]]
        snaps = {}
        for k in range(da.sizes.get("step", 1)):
            sl = da.isel(step=k)
            h = int(sl["step"].values / np.timedelta64(1, "h"))
            snaps[h] = flat(regrid(sl, DET_SP))
        out = []
        for i in range(HOURS_MAX // PERIOD):
            mid = snaps.get(i * PERIOD + SNAP_STEP)
            out.append(mid if mid is not None else snaps.get(i * PERIOD))
        return out

    us, vs = uv_series("10u"), uv_series("10v")
    speed = [
        (np.hypot(us[s], vs[s]) * MS_TO_MPH) if us[s] is not None and vs[s] is not None else None
        for s in range(HOURS_MAX // PERIOD)
    ]
    try:
        gust = [g * MS_TO_MPH if g is not None else None for g in series_for("10fg6", DET_SP, "max")]
    except Exception:
        log("[ecmwf] sin 10fg6; ráfagas ≈ viento × 1.5")
        gust = [s_ * 1.5 if s_ is not None else None for s_ in speed]
    rain = [r * 1000.0 if r is not None else None for r in series_for("tp", DET_SP, "diff")]

    det = {
        "grid": grid_json(DET_SP),
        "times": period_times(run_dt),
        "wind": pack(speed, npoints_d),
        "gusts": pack(gust, npoints_d),
        "rain": pack(rain, npoints_d),
        "u": pack([x * MS_TO_MPH if x is not None else None for x in us], npoints_d),
        "v": pack([x * MS_TO_MPH if x is not None else None for x in vs], npoints_d),
        "members": 1,
        "generated": int(dt.datetime.now(dt.timezone.utc).timestamp()),
        "run": f"{run_dt:%Y%m%d%H}",
    }
    write_json(os.path.join(outdir, "ecmwf", "det.json"), det)

    # ── ensemble (ENS): 51 miembros, pasos de 6 h ──
    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as f:
        ens_path = f.name
    client.retrieve(
        type=["cf", "pf"], stream="enfo", step=steps6,
        param=["10u", "10v", "tp"], target=ens_path,
    )
    log("[ecmwf] ENS descargado")
    lat_p, lon_p = grid_axes(PROB_SP)
    npoints_p = len(lat_p) * len(lon_p)

    def ens_members(short, mode, scale=1.0):
        ds = xr.open_dataset(
            ens_path, engine="cfgrib",
            backend_kwargs={"indexpath": "", "filter_by_keys": {"shortName": short}},
        ).load()
        da = ds[list(ds.data_vars)[0]]
        members = []
        num_dim = "number" if "number" in da.dims else None
        count = da.sizes.get(num_dim, 1)
        for m in range(count):
            sl = da.isel({num_dim: m}) if num_dim else da
            snaps = {}
            for k in range(sl.sizes.get("step", 1)):
                s2 = sl.isel(step=k)
                h = int(s2["step"].values / np.timedelta64(1, "h"))
                snaps[h] = flat(regrid(s2, PROB_SP)) * scale
            members.append(periods_from_snapshots(snaps, mode))
        return members

    mu = ens_members("10u", "max", MS_TO_MPH)
    mv = ens_members("10v", "max", MS_TO_MPH)
    # velocidad por miembro a partir de u/v del FINAL del período (6-hourly)
    mspeed = []
    for i in range(len(mu)):
        mem = []
        for s in range(HOURS_MAX // PERIOD):
            if mu[i][s] is None or mv[i][s] is None:
                mem.append(None)
            else:
                mem.append(np.hypot(mu[i][s], mv[i][s]))
        mspeed.append(mem)
    mrain = ens_members("tp", "diff", 1000.0)

    prob = {
        "grid": grid_json(PROB_SP),
        "times": period_times(run_dt),
        "members": len(mspeed),
        "wind": prob_pack(mspeed, THR_WIND_MPH, npoints_p),
        "gusts": None,  # el ENS abierto no publica ráfagas
        "rain": prob_pack(mrain, THR_RAIN_MM, npoints_p),
        "generated": int(dt.datetime.now(dt.timezone.utc).timestamp()),
        "run": f"{run_dt:%Y%m%d%H}",
    }
    write_json(os.path.join(outdir, "ecmwf", "prob.json"), prob)
    return {"det": True, "prob": True, "run": f"{run_dt:%Y%m%d%H}", "members": len(mspeed)}


# ═══════════════════════════════ NOAA ════════════════════════════════════

GFS_BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
GEFS_BUCKET = "https://noaa-gefs-pds.s3.amazonaws.com"


def latest_run(hours_back=6):
    """corrida sinóptica más reciente con margen de publicación"""
    now = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours_back)
    hh = (now.hour // 6) * 6
    return now.replace(hour=hh, minute=0, second=0, microsecond=0)


def idx_ranges(idx_text, wanted):
    """Del .idx de NOAA: rangos de bytes de los campos pedidos.
    wanted: lista de subcadenas tipo ':UGRD:10 m above ground:'."""
    lines = idx_text.splitlines()
    out = []
    for i, line in enumerate(lines):
        if any(w in line for w in wanted):
            start = int(line.split(":")[1])
            end = ""
            for j in range(i + 1, len(lines)):
                nxt = int(lines[j].split(":")[1])
                if nxt > start:
                    end = nxt - 1
                    break
            out.append((start, end))
    return out


def fetch_noaa_fields(base_url, wanted):
    """Descarga solo los campos pedidos de un GRIB con su .idx."""
    idx = http_get(base_url + ".idx").decode("utf-8", "replace")
    chunks = []
    for start, end in idx_ranges(idx, wanted):
        rng_end = end if end != "" else start + 40_000_000
        chunks.append(http_range(base_url, start, rng_end))
    return b"".join(chunks)


NOAA_WANTED = [
    ":UGRD:10 m above ground:",
    ":VGRD:10 m above ground:",
    ":GUST:surface:",
    ":APCP:surface:",
]


def build_noaa(outdir):
    import xarray as xr

    run = latest_run(hours_back=6)
    ymd, hh = f"{run:%Y%m%d}", f"{run:%H}"
    steps = list(range(0, HOURS_MAX + 1, SNAP_STEP))

    # ── GFS determinista 0.25° ──
    raws = []
    for h in steps:
        url = f"{GFS_BUCKET}/gfs.{ymd}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{h:03d}"
        raws.append((h, fetch_noaa_fields(url, NOAA_WANTED)))
    log(f"[noaa] GFS {ymd}{hh} · {len(raws)} pasos")

    lat_d, lon_d = grid_axes(DET_SP)
    npoints_d = len(lat_d) * len(lon_d)

    def decode(raw, filt):
        ds = open_grib(raw, filt).load()
        return flat(regrid(ds[list(ds.data_vars)[0]], DET_SP))

    su, sv, sg, sr = {}, {}, {}, {}
    for h, raw in raws:
        try:
            su[h] = decode(raw, {"shortName": "10u"})
            sv[h] = decode(raw, {"shortName": "10v"})
        except Exception:
            pass
        try:
            sg[h] = decode(raw, {"shortName": "gust"})
        except Exception:
            pass
        try:
            # APCP: acumulado del bucket (3/6 h según paso)
            sr[h] = decode(raw, {"shortName": "tp"})
        except Exception:
            pass

    nper = HOURS_MAX // PERIOD
    speed, gust, us, vs = [], [], [], []
    for i in range(nper):
        hs = [i * PERIOD + SNAP_STEP, (i + 1) * PERIOD]
        sp_parts = [np.hypot(su[h], sv[h]) * MS_TO_MPH for h in hs if h in su and h in sv]
        speed.append(np.maximum.reduce(sp_parts) if sp_parts else None)
        g_parts = [sg[h] * MS_TO_MPH for h in hs if h in sg]
        gust.append(np.maximum.reduce(g_parts) if g_parts else None)
        mid = i * PERIOD + SNAP_STEP
        us.append(su.get(mid) * MS_TO_MPH if mid in su else None)
        vs.append(sv.get(mid) * MS_TO_MPH if mid in sv else None)
    # lluvia: APCP de GFS viene en cubos que se reinician cada 6 h → el paso
    # múltiplo de 6 trae el acumulado 6-horario completo
    rain = [sr.get((i + 1) * PERIOD) for i in range(nper)]

    det = {
        "grid": grid_json(DET_SP),
        "times": period_times(run),
        "wind": pack(speed, npoints_d),
        "gusts": pack(gust, npoints_d),
        "rain": pack(rain, npoints_d),
        "u": pack(us, npoints_d),
        "v": pack(vs, npoints_d),
        "members": 1,
        "generated": int(dt.datetime.now(dt.timezone.utc).timestamp()),
        "run": f"{ymd}{hh}",
    }
    write_json(os.path.join(outdir, "noaa", "det.json"), det)

    # ── GEFS 0.25° (pgrb2s): 30 perturbados + control, pasos de 6 h ──
    lat_p, lon_p = grid_axes(PROB_SP)
    npoints_p = len(lat_p) * len(lon_p)
    steps6 = list(range(0, HOURS_MAX + 1, PERIOD))
    members = ["gec00"] + [f"gep{m:02d}" for m in range(1, 31)]

    def decode_p(raw, filt):
        ds = open_grib(raw, filt).load()
        return flat(regrid(ds[list(ds.data_vars)[0]], PROB_SP))

    mspeed, mrain = [], []
    for mem in members:
        su2, sv2, sr2 = {}, {}, {}
        try:
            for h in steps6:
                url = (
                    f"{GEFS_BUCKET}/gefs.{ymd}/{hh}/atmos/pgrb2sp25/"
                    f"{mem}.t{hh}z.pgrb2s.0p25.f{h:03d}"
                )
                raw = fetch_noaa_fields(url, NOAA_WANTED)
                try:
                    su2[h] = decode_p(raw, {"shortName": "10u"})
                    sv2[h] = decode_p(raw, {"shortName": "10v"})
                except Exception:
                    pass
                try:
                    sr2[h] = decode_p(raw, {"shortName": "tp"})
                except Exception:
                    pass
        except Exception as e:
            log(f"[noaa] miembro {mem} falló: {e}")
            continue
        nsp, nrn = [], []
        for i in range(len(steps6) - 1):
            h = steps6[i + 1]
            nsp.append(np.hypot(su2[h], sv2[h]) * MS_TO_MPH if h in su2 and h in sv2 else None)
            nrn.append(sr2.get(h))
        mspeed.append(nsp)
        mrain.append(nrn)

    prob = {
        "grid": grid_json(PROB_SP),
        "times": period_times(run),
        "members": len(mspeed),
        "wind": prob_pack(mspeed, THR_WIND_MPH, npoints_p) if mspeed else None,
        "gusts": None,
        "rain": prob_pack(mrain, THR_RAIN_MM, npoints_p) if mrain else None,
        "generated": int(dt.datetime.now(dt.timezone.utc).timestamp()),
        "run": f"{ymd}{hh}",
    }
    write_json(os.path.join(outdir, "noaa", "prob.json"), prob)
    return {"det": True, "prob": bool(mspeed), "run": f"{ymd}{hh}", "members": len(mspeed)}


# ═══════════════════════════════ GEM (Canadá) ════════════════════════════

DATAMART = "https://dd.weather.gc.ca"


def build_gem(outdir):
    import xarray as xr

    run = latest_run(hours_back=7)
    ymd, hh = f"{run:%Y%m%d}", f"{run:%H}"
    lat_d, lon_d = grid_axes(DET_SP)
    npoints_d = len(lat_d) * len(lon_d)
    steps = list(range(0, HOURS_MAX + 1, SNAP_STEP))

    def gem_file(var, h):
        # GDPS 15 km, un archivo pequeño por variable y paso
        return (
            f"{DATAMART}/model_gem_global/15km/grib2/lat_lon/{hh}/{h:03d}/"
            f"CMC_glb_{var}_latlon.15x.15_{ymd}{hh}_P{h:03d}.grib2"
        )

    def snaps_for(var, sp, scale=1.0):
        out = {}
        for h in steps:
            try:
                ds = open_grib(http_get(gem_file(var, h))).load()
                out[h] = flat(regrid(ds[list(ds.data_vars)[0]], sp)) * scale
            except Exception:
                pass
        return out

    su = snaps_for("UGRD_TGL_10", DET_SP, MS_TO_MPH)
    sv = snaps_for("VGRD_TGL_10", DET_SP, MS_TO_MPH)
    sg = snaps_for("GUST_TGL_10", DET_SP, MS_TO_MPH)
    sr = snaps_for("APCP_SFC_0", DET_SP)  # acumulado desde inicio
    log(f"[gem] GDPS {ymd}{hh}: u{len(su)} v{len(sv)} gust{len(sg)} rain{len(sr)}")

    nper = HOURS_MAX // PERIOD
    speed, gust, us, vs, rain = [], [], [], [], []
    for i in range(nper):
        hs = [i * PERIOD + SNAP_STEP, (i + 1) * PERIOD]
        sp_parts = [np.hypot(su[h], sv[h]) for h in hs if h in su and h in sv]
        speed.append(np.maximum.reduce(sp_parts) if sp_parts else None)
        g_parts = [sg[h] for h in hs if h in sg]
        gust.append(np.maximum.reduce(g_parts) if g_parts else None)
        mid = i * PERIOD + SNAP_STEP
        us.append(su.get(mid))
        vs.append(sv.get(mid))
        a, b = sr.get(i * PERIOD), sr.get((i + 1) * PERIOD)
        if a is None and i == 0 and b is not None:
            a = np.zeros_like(b)
        rain.append((b - a) if a is not None and b is not None else None)

    det = {
        "grid": grid_json(DET_SP),
        "times": period_times(run),
        "wind": pack(speed, npoints_d),
        "gusts": pack(gust, npoints_d),
        "rain": pack(rain, npoints_d),
        "u": pack(us, npoints_d),
        "v": pack(vs, npoints_d),
        "members": 1,
        "generated": int(dt.datetime.now(dt.timezone.utc).timestamp()),
        "run": f"{ymd}{hh}",
    }
    write_json(os.path.join(outdir, "gem", "det.json"), det)

    # ── GEPS (ensemble, 0.5°): cada archivo trae TODOS los miembros ──
    lat_p, lon_p = grid_axes(PROB_SP)
    npoints_p = len(lat_p) * len(lon_p)
    steps6 = list(range(0, HOURS_MAX + 1, PERIOD))

    def geps_members(var, scale=1.0):
        """→ lista por miembro de dict paso→matriz"""
        per_member = {}
        for h in steps6:
            url = (
                f"{DATAMART}/ensemble/geps/grib2/raw/{hh}/{h:03d}/"
                f"CMC_geps-raw_{var}_latlon0p5x0p5_{ymd}{hh}_P{h:03d}_allmbrs.grib2"
            )
            try:
                ds = open_grib(http_get(url)).load()
                da = ds[list(ds.data_vars)[0]]
                if "number" in da.dims:
                    for m in range(da.sizes["number"]):
                        per_member.setdefault(m, {})[h] = flat(regrid(da.isel(number=m), PROB_SP)) * scale
                else:
                    per_member.setdefault(0, {})[h] = flat(regrid(da, PROB_SP)) * scale
            except Exception:
                pass
        return per_member

    gu = geps_members("UGRD_TGL_10m", MS_TO_MPH)
    gv = geps_members("VGRD_TGL_10m", MS_TO_MPH)
    gr = geps_members("APCP_SFC", 1.0)

    mspeed, mrain = [], []
    for m in sorted(set(gu) & set(gv)):
        mem = []
        for i in range(nper):
            h = (i + 1) * PERIOD
            mem.append(np.hypot(gu[m][h], gv[m][h]) if h in gu[m] and h in gv[m] else None)
        mspeed.append(mem)
    for m in sorted(gr):
        mem = []
        for i in range(nper):
            a, b = gr[m].get(i * PERIOD), gr[m].get((i + 1) * PERIOD)
            if a is None and i == 0 and b is not None:
                a = np.zeros_like(b)
            mem.append((b - a) if a is not None and b is not None else None)
        mrain.append(mem)

    prob = {
        "grid": grid_json(PROB_SP),
        "times": period_times(run),
        "members": len(mspeed),
        "wind": prob_pack(mspeed, THR_WIND_MPH, npoints_p) if mspeed else None,
        "gusts": None,
        "rain": prob_pack(mrain, THR_RAIN_MM, npoints_p) if mrain else None,
        "generated": int(dt.datetime.now(dt.timezone.utc).timestamp()),
        "run": f"{ymd}{hh}",
    }
    write_json(os.path.join(outdir, "gem", "prob.json"), prob)
    return {"det": True, "prob": bool(mspeed), "run": f"{ymd}{hh}", "members": len(mspeed)}


# ═══════════════════════════════ salida ══════════════════════════════════

def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"), allow_nan=False)
    log(f"  → {path} ({os.path.getsize(path) // 1024} KB)")


def main():
    outdir = os.path.abspath(OUT_DIR)
    centers = {}
    for name, builder in (("ecmwf", build_ecmwf), ("noaa", build_noaa), ("gem", build_gem)):
        try:
            centers[name] = builder(outdir)
            log(f"[{name}] OK")
        except Exception:
            log(f"[{name}] FALLÓ:")
            traceback.print_exc()
            centers[name] = {"det": False, "prob": False}
    meta = {
        "generated": int(dt.datetime.now(dt.timezone.utc).timestamp()),
        "centers": centers,
    }
    write_json(os.path.join(outdir, "meta.json"), meta)
    ok = any(c.get("det") for c in centers.values())
    log("listo" if ok else "ningún centro disponible")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
