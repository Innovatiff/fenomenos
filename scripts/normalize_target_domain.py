#!/usr/bin/env python3
"""Normalize Fenómenos-owned absolute URLs for the target domain."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD = "https://fenomenosdelcaribe.org"
NEW = "https://fenomenosmedia.org"

for path in ROOT.rglob("*.html"):
    if ".git" in path.parts or "articulos" in path.parts:
        continue
    text = path.read_text()
    updated = text.replace(OLD, NEW)
    if updated != text:
        path.write_text(updated)
        print(path.relative_to(ROOT))
