#!/usr/bin/env python3
"""Publish the public Firestore article collection as crawlable static HTML.

The command is deliberately deterministic: the same Firestore export produces
the same article pages, index manifest and sitemap.  It never writes to
Firestore or deploys anything.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import fcntl
import hashlib
import html
import json
import os
import re
import shutil
import tempfile
import time
import unicodedata
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "fenomenos-61255"
CONFIG = ROOT / "config/site-migration.json"
CONFIG_ORIGIN = json.loads(CONFIG.read_text()).get("targetOrigin", "https://fenomenosmedia.org") if CONFIG.exists() else "https://fenomenosmedia.org"
ORIGIN = os.environ.get("SITE_ORIGIN", CONFIG_ORIGIN).rstrip("/")
ALLOWED = {"p", "div", "br", "b", "strong", "i", "em", "u", "mark", "span"}
# The Studio stores uploaded images as base64 data URIs inside Firestore.
# Inlined in HTML they made every page weigh hundreds of KB, so the build
# writes each one once to a content-addressed file and links to it instead.
IMAGE_DIR = ROOT / "img/articulos"
IMAGE_URL = "/img/articulos"
DATA_URI = re.compile(r"data:image/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)", re.I)
IMAGE_NAME = re.compile(r"[0-9a-f]{20}\.(?:jpg|png|webp|gif)")


class SafeHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []

    def handle_data(self, data):
        self.out.append(html.escape(data))

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag not in ALLOWED:
            return
        if tag == "br":
            self.out.append("<br>")
            return
        kept = []
        for key, value in attrs:
            if key == "style" and value:
                styles = []
                for item in value.split(";"):
                    if ":" not in item:
                        continue
                    prop, val = (x.strip() for x in item.split(":", 1))
                    if prop in {"text-align", "background-color"} and re.fullmatch(r"[\w #(),.%+-]+", val):
                        styles.append(f"{prop}: {val}")
                if styles:
                    kept.append(("style", "; ".join(styles)))
        attrs_text = "".join(f' {k}="{html.escape(v, quote=True)}"' for k, v in kept)
        self.out.append(f"<{tag}{attrs_text}>")

    def handle_endtag(self, tag):
        if tag.lower() in ALLOWED and tag.lower() != "br":
            self.out.append(f"</{tag.lower()}>")


def safe_html(value) -> str:
    parser = SafeHTML()
    parser.feed(str(value or ""))
    return "".join(parser.out)


def plain(value) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(value or ""))).strip()


def decode_firestore(value):
    if not isinstance(value, dict):
        return value
    if "stringValue" in value:
        return value["stringValue"]
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "booleanValue" in value:
        return value["booleanValue"]
    if "timestampValue" in value:
        return value["timestampValue"]
    if "nullValue" in value:
        return None
    if "arrayValue" in value:
        return [decode_firestore(x) for x in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return {k: decode_firestore(v) for k, v in value["mapValue"].get("fields", {}).items()}
    return value


def fetch_firestore() -> list[dict]:
    endpoint = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents:runQuery"
    query = {"structuredQuery": {"from": [{"collectionId": "articles"}], "where": {"fieldFilter": {"field": {"fieldPath": "status"}, "op": "EQUAL", "value": {"stringValue": "published"}}}}}
    req = urllib.request.Request(endpoint, data=json.dumps(query).encode(), headers={"Content-Type": "application/json"})
    last_error = None
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                rows = json.load(response)
            break
        except Exception as exc:
            last_error = exc
            print(f"Firestore read attempt {attempt}/3 failed: {exc}", file=__import__("sys").stderr)
            if attempt < 3:
                time.sleep(2 ** (attempt - 1))
    else:
        raise RuntimeError("Firestore publication read failed after 3 attempts") from last_error
    articles = []
    for row in rows:
        document = row.get("document")
        if not document:
            continue
        item = {k: decode_firestore(v) for k, v in document.get("fields", {}).items()}
        item["id"] = document["name"].rsplit("/", 1)[-1]
        if item.get("status") == "published":
            articles.append(item)
    return articles


def externalize_image(value, written: set):
    """Return a file URL for a base64 data URI; leave every other value as is."""
    match = DATA_URI.fullmatch(str(value or "").strip()) if isinstance(value, str) else None
    if not match:
        return value
    data = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    ext = {"jpeg": "jpg"}.get(match.group(1).lower(), match.group(1).lower())
    name = f"{hashlib.sha256(data).hexdigest()[:20]}.{ext}"
    target = IMAGE_DIR / name
    if not target.exists():
        IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    written.add(name)
    return f"{IMAGE_URL}/{name}"


def externalize_article_images(article: dict, written: set) -> dict:
    sections = [
        dict(section, src=externalize_image(section.get("src"), written)) if isinstance(section, dict) and section.get("type") == "image" else section
        for section in article.get("sections") or []
    ]
    return dict(article, cover=externalize_image(article.get("cover"), written), sections=sections)


def prune_images(written: set):
    if not IMAGE_DIR.exists():
        return
    for old in IMAGE_DIR.iterdir():
        if IMAGE_NAME.fullmatch(old.name) and old.name not in written:
            old.unlink()


def absolute_url(value: str) -> str:
    return urljoin(ORIGIN + "/", value)


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "articulo"


def date_value(value):
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        return dt.datetime.fromisoformat(text).astimezone(dt.timezone.utc)
    except ValueError:
        return None


def date_text(value):
    parsed = date_value(value)
    return parsed.strftime("%Y-%m-%d") if parsed else ""


def author_name(article):
    value = article.get("author")
    if isinstance(value, dict):
        value = value.get("name")
    return str(value).strip() if value else ""


def sources(article):
    value = article.get("sources", article.get("source", []))
    if isinstance(value, str):
        return [value] if value.strip() else []
    return value if isinstance(value, list) else []


def section_html(section):
    kind = section.get("type")
    if kind == "heading":
        text = section.get("html") or section.get("text")
        return f'<h2 class="post__heading">{safe_html(text)}</h2>' if plain(text) else ""
    if kind == "text":
        text = section.get("html") or section.get("text")
        return f'<div class="post__paragraph">{safe_html(text)}</div>' if plain(text) else ""
    if kind == "quote":
        text = section.get("html") or section.get("text")
        cite = f'<cite class="post__cite">{html.escape(str(section.get("cite")))}</cite>' if section.get("cite") else ""
        return f'<blockquote class="post__quote">{safe_html(text)}{cite}</blockquote>' if plain(text) else ""
    if kind == "image" and section.get("src"):
        caption = f'<figcaption class="post__caption">{html.escape(str(section.get("caption")))}</figcaption>' if section.get("caption") else ""
        return f'<figure class="post__figure"><img src="{html.escape(str(section["src"]), quote=True)}" alt="{html.escape(str(section.get("caption", "")), quote=True)}" loading="lazy">{caption}</figure>'
    if kind == "list":
        items = section.get("itemsHtml") or section.get("items") or []
        rendered = []
        for item in items:
            text = safe_html(item) if isinstance(item, str) and "<" in item else html.escape(str(item))
            if plain(text):
                rendered.append(f"<li>{text}</li>")
        return f'<ul class="post__list">{"".join(rendered)}</ul>' if rendered else ""
    return ""


def article_body(article):
    chunks = []
    for section in article.get("sections") or []:
        chunks.append(section_html(section))
    return "".join(chunks)


def static_root(article):
    title = article.get("title") or plain(article.get("titleHtml"))
    excerpt = article.get("excerpt") or plain(article.get("excerptHtml"))
    when = date_text(article.get("publishedAt") or article.get("createdAt"))
    tags = article.get("tags") or ([article.get("tag")] if article.get("tag") else [])
    tags = [str(x) for x in tags if x]
    meta = "".join(f'<span class="post__tag">{html.escape(x)}</span>' for x in tags)
    if when:
        meta += f'<time class="post__date" datetime="{when}">{when}</time>'
    author = author_name(article)
    if author:
        meta += f'<span class="post__author">Por {html.escape(author)}</span>'
    cover = f'<figure class="post__cover"><img src="{html.escape(article["cover"], quote=True)}" alt="{html.escape(title, quote=True)}"></figure>' if article.get("cover") else ""
    footer = article.get("footer") or plain(article.get("footerHtml"))
    footer_html = f'<footer class="post__footer"><span class="post__footer-label">Nota del artículo</span><div class="post__footer-text">{safe_html(article.get("footerHtml") or footer)}</div></footer>' if footer else ""
    source_items = []
    for source in sources(article):
        if isinstance(source, dict):
            label, href = source.get("name") or source.get("label") or source.get("title") or source.get("url"), source.get("url")
            if href:
                source_items.append(f'<li><a href="{html.escape(href, quote=True)}" rel="noopener">{html.escape(str(label or href))}</a></li>')
            elif label:
                source_items.append(f'<li>{html.escape(str(label))}</li>')
        elif str(source).strip():
            source_items.append(f'<li>{html.escape(str(source))}</li>')
    source_html = f'<section class="post__sources"><h2>Fuentes</h2><ul>{"".join(source_items)}</ul></section>' if source_items else ""
    return f'''<header class="post__head"><div class="post__meta">{meta}<span class="post__read">Artículo</span></div><h1 class="heading__primary post__title">{safe_html(article.get("titleHtml") or title)}</h1>{f'<p class="post__excerpt">{safe_html(article.get("excerptHtml") or excerpt)}</p>' if excerpt else ""}</header>{cover}<div class="post__body">{article_body(article)}</div>{footer_html}{source_html}'''


def card(article, href):
    title = article.get("title") or plain(article.get("titleHtml"))
    excerpt = article.get("excerpt") or plain(article.get("excerptHtml"))
    date = date_text(article.get("publishedAt") or article.get("createdAt"))
    cover = f'<img src="{html.escape(str(article["cover"]), quote=True)}" alt="" loading="lazy" decoding="async">' if article.get("cover") else ""
    tag = (article.get("tags") or [article.get("tag")] or [""])[0]
    return f'<li class="card card--article"><a class="card__inner" href="{html.escape(href, quote=True)}"><span class="article__media">{cover}</span><span class="article__meta">{html.escape(str(tag))} · <time datetime="{date}">{date}</time></span><h3 class="card__title">{html.escape(str(title))}</h3><p class="card__text">{html.escape(str(excerpt))}</p><span class="card__link">Leer más →</span></a></li>'


def update_indexes(manifest):
    archive = json.loads((ROOT / "archivo/catalog.json").read_text())
    live_rows = []
    for article in manifest:
        live_rows.append({"id": article["id"], "slug": article["slug"], "title": article.get("title") or plain(article.get("titleHtml")), "excerpt": article.get("excerpt") or plain(article.get("excerptHtml")), "publishedAt": article.get("publishedAt") or article.get("createdAt"), "cover": article.get("cover", ""), "tags": article.get("tags") or ([article.get("tag")] if article.get("tag") else []), "categories": article.get("categories", [])})
    archive_rows = [{**x, "isArchive": True, "archivePath": x["path"]} for x in archive]
    rows = sorted(live_rows + archive_rows, key=lambda x: str(x.get("publishedAt") or ""), reverse=True)
    page = ROOT / "articulos.html"
    text = page.read_text()
    chosen = rows
    grid = "\n".join(card(x, f'/articulos/{x["slug"]}/' if not x.get("isArchive") else x["path"]) for x in chosen)
    text = re.sub(r'(<ul[^>]*id="articles-grid"[^>]*>).*?(</ul>)', lambda m: m.group(1) + "\n" + grid + "\n" + m.group(2), text, count=1, flags=re.S)
    payload = json.dumps(chosen, ensure_ascii=False).replace("<", "\\u003c")
    text = re.sub(r'<script id="initial-articles" type="application/json">.*?</script>', f'<script id="initial-articles" type="application/json">{payload}</script>', text, count=1, flags=re.S)
    page.write_text(text)

    home = ROOT / "index.html"
    home_text = home.read_text()
    home_rows = rows[:4]
    home_grid = "\n".join(card(x, f'/articulos/{x["slug"]}/' if not x.get("isArchive") else x["path"]) for x in home_rows)
    home_text = re.sub(r'(<ul[^>]*id="home-articles"[^>]*>).*?(</ul>)', lambda m: m.group(1) + "\n" + home_grid + "\n" + m.group(2), home_text, count=1, flags=re.S)
    home_payload = json.dumps(home_rows, ensure_ascii=False).replace("<", "\\u003c")
    home_text = re.sub(r'<script id="initial-articles" type="application/json">.*?</script>', f'<script id="initial-articles" type="application/json">{home_payload}</script>', home_text, count=1, flags=re.S)
    home.write_text(home_text)


def render_page(template: str, article: dict, slug: str) -> str:
    title = article.get("title") or plain(article.get("titleHtml")) or "Artículo"
    excerpt = article.get("excerpt") or plain(article.get("excerptHtml"))
    canonical = f"{ORIGIN}/articulos/{slug}/"
    page = re.sub(r'<script async src="https://pagead\.googlesyndication\.com/pagead/js/adsbygoogle\.js\?client=[^"]+"[^>]*></script>\s*', "", template, flags=re.I)
    page = re.sub(r'<title>.*?</title>', f'<title>{html.escape(title)} | Fenómenos Media</title>', page, count=1, flags=re.S)
    page = re.sub(r'<meta\s+name="description"[^>]*>', f'<meta name="description" content="{html.escape(excerpt, quote=True)}">', page, count=1, flags=re.I)
    page = re.sub(r'<link rel="canonical"[^>]*>\s*', "", page, flags=re.I)
    schema = {"@context": "https://schema.org", "@type": "Article", "headline": title, "mainEntityOfPage": canonical}
    if date_value(article.get("publishedAt") or article.get("createdAt")):
        schema["datePublished"] = date_value(article.get("publishedAt") or article.get("createdAt")).isoformat().replace("+00:00", "Z")
    if date_value(article.get("updatedAt")):
        schema["dateModified"] = date_value(article["updatedAt"]).isoformat().replace("+00:00", "Z")
    if author_name(article):
        schema["author"] = {"@type": "Person", "name": author_name(article)}
    og_image = ""
    if article.get("cover") and not str(article["cover"]).startswith("data:"):
        schema["image"] = absolute_url(article["cover"])
        og_image = f'<meta property="og:image" content="{html.escape(schema["image"], quote=True)}">'
    head = f'<link rel="canonical" href="{canonical}"><meta property="og:type" content="article"><meta property="og:title" content="{html.escape(title, quote=True)}"><meta property="og:url" content="{canonical}">{og_image}<script type="application/ld+json">{json.dumps(schema, ensure_ascii=False)}</script>'
    page = page.replace('    <meta name="robots" content="noindex, follow" />\n', '')
    page = page.replace('</head>', head + '</head>', 1)
    page = page.replace('<div id="post-root">', f'<div id="post-root" data-article-id="{html.escape(article["id"], quote=True)}">', 1)
    page = re.sub(r'<div id="post-root"[^>]*>.*?</div>\s*<!-- ═══════════════════ COMENTARIOS', lambda m: m.group(0).split('<!-- ═══════════════════ COMENTARIOS')[0].rsplit('</div>', 1)[0] + static_root(article) + '</div>\n\n            <!-- ═══════════════════ COMENTARIOS', page, count=1, flags=re.S)
    # The template is also used at /articulos/<slug>/; make its asset URLs
    # root-relative so no-JS rendering works at every depth.
    page = re.sub(r'(\b(?:href|src)=["\'])(?!/|[a-z]+:|#)([^"\']+)', r'\1/\2', page, flags=re.I)
    return page


def update_slug_redirects(previous_routes, manifest):
    current_by_id = {article["id"]: article["slug"] for article in manifest}
    history = ROOT / "data/article-redirects.json"
    previous = json.loads(history.read_text()) if history.exists() else []
    aliases = {row["from"]: row["id"] for row in previous}
    live_paths = {f"/articulos/{slug}/" for slug in current_by_id.values()}
    for article_id, old_slug in previous_routes.items():
        new_slug = current_by_id.get(article_id)
        if new_slug and new_slug != old_slug:
            aliases[f"/articulos/{old_slug}/"] = article_id
    redirects = [
        {"from": path, "to": f"/articulos/{current_by_id[article_id]}/", "status": 301, "id": article_id}
        for path, article_id in sorted(aliases.items())
        if path not in live_paths and article_id in current_by_id
    ]
    (ROOT / "data/article-redirects.json").write_text(json.dumps(redirects, ensure_ascii=False, indent=2) + "\n")
    redirects_file = ROOT / "_redirects"
    text = redirects_file.read_text() if redirects_file.exists() else ""
    text = re.sub(r"\n?# BEGIN GENERATED ARTICLE REDIRECTS\n.*?# END GENERATED ARTICLE REDIRECTS\n?", "\n", text, flags=re.S)
    if redirects:
        block = "\n# BEGIN GENERATED ARTICLE REDIRECTS\n" + "\n".join(f'{x["from"]} {x["to"]} {x["status"]}' for x in redirects) + "\n# END GENERATED ARTICLE REDIRECTS\n"
        text = text.rstrip() + block
    redirects_file.write_text(text)


def _generate():
    global ORIGIN
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-json", type=Path, help="Firestore-shaped article list for offline/reproducible builds")
    parser.add_argument("--origin", default=ORIGIN)
    args = parser.parse_args()
    ORIGIN = args.origin.rstrip("/")
    previous_routes = {}
    routes_file = ROOT / "data/article-routes.json"
    if routes_file.exists():
        previous_routes = {row["id"]: row["slug"] for row in json.loads(routes_file.read_text()) if row.get("id") and row.get("slug")}
    raw = json.loads(args.source_json.read_text()) if args.source_json else fetch_firestore()
    if raw and isinstance(raw[0], dict) and raw[0].get("document"):
        normalized = []
        for row in raw:
            document = row.get("document")
            if not document:
                continue
            item = {k: decode_firestore(v) for k, v in document.get("fields", {}).items()}
            item["id"] = document["name"].rsplit("/", 1)[-1]
            normalized.append(item)
        raw = normalized
    articles = [x for x in raw if x.get("status") == "published"]
    articles.sort(key=lambda x: date_value(x.get("publishedAt") or x.get("createdAt")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc), reverse=True)
    used = set()
    images = set()
    manifest = []
    for article in articles:
        article = externalize_article_images(article, images)
        if not plain(article.get("title") or article.get("titleHtml")) or not plain(article_body(article)):
            raise ValueError(f"Published article {article.get('id')} has no truthful title/body; refusing to publish it")
        base = slugify(article.get("slug") or article.get("title") or article["id"])
        slug = base
        if slug in used:
            slug = f"{base}-{slugify(article['id'])[:8]}"
        used.add(slug)
        article = dict(article, slug=slug)
        manifest.append(article)
        destination = ROOT / "articulos" / slug / "index.html"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(render_page((ROOT / "articulo.html").read_text(), article, slug))
    generated_root = ROOT / "articulos"
    obsolete = set(previous_routes.values()) - used
    for old_page in generated_root.glob("*/index.html"):
        if old_page.parent.name in obsolete:
            old_page.unlink()
            try:
                old_page.parent.rmdir()
            except OSError:
                pass
    prune_images(images)
    (ROOT / "data/published-articles.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    static = [{"id": x["id"], "slug": x["slug"], "title": x.get("title", ""), "publishedAt": x.get("publishedAt") or x.get("createdAt"), "author": author_name(x)} for x in manifest]
    (ROOT / "data/article-routes.json").write_text(json.dumps(static, ensure_ascii=False, indent=2) + "\n")
    update_slug_redirects(previous_routes, manifest)
    update_indexes(manifest)
    # Keep existing app/maps/archive URLs, replace any previous generated article routes.
    sitemap = ROOT / "sitemap.xml"
    old = ET.parse(sitemap).getroot() if sitemap.exists() else ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    for node in list(old):
        loc = node.findtext(f"{ns}loc") or ""
        if loc.startswith("https://fenomenosdelcaribe.org"):
            node.find(f"{ns}loc").text = ORIGIN + loc.removeprefix("https://fenomenosdelcaribe.org")
            loc = node.findtext(f"{ns}loc") or ""
        if "/articulos/" in loc or loc.rstrip("/").endswith("/articulos"):
            old.remove(node)
    for path in ["/articulos/"] + [f"/articulos/{x['slug']}/" for x in manifest]:
        node = ET.SubElement(old, f"{ns}url")
        ET.SubElement(node, f"{ns}loc").text = ORIGIN + path
    ET.register_namespace("", "http://www.sitemaps.org/schemas/sitemap/0.9")
    ET.ElementTree(old).write(sitemap, encoding="utf-8", xml_declaration=True)
    print(json.dumps({"published": len(manifest), "routes": [x["slug"] for x in manifest], "origin": ORIGIN}, ensure_ascii=False))


def main():
    lock_path = ROOT / ".publish-firestore.lock"
    lock_path.touch()
    with lock_path.open("r+") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise SystemExit("Another Firestore publication is already running") from exc
        targets = [ROOT / "articulos.html", ROOT / "index.html", ROOT / "sitemap.xml", ROOT / "_redirects", ROOT / "data/published-articles.json", ROOT / "data/article-routes.json", ROOT / "data/article-redirects.json"]
        with tempfile.TemporaryDirectory(prefix="firestore-publish-backup-") as backup:
            backup_path = Path(backup)
            for target in targets:
                if target.exists():
                    destination = backup_path / target.relative_to(ROOT)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(target, destination)
            generated_backup = backup_path / "articulos"
            if (ROOT / "articulos").exists():
                shutil.copytree(ROOT / "articulos", generated_backup)
            images_backup = backup_path / "img-articulos"
            if IMAGE_DIR.exists():
                shutil.copytree(IMAGE_DIR, images_backup)
            try:
                _generate()
            except Exception:
                for target in targets:
                    saved = backup_path / target.relative_to(ROOT)
                    if saved.exists():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(saved, target)
                    elif target.exists():
                        target.unlink()
                if (ROOT / "articulos").exists():
                    shutil.rmtree(ROOT / "articulos")
                if generated_backup.exists():
                    shutil.copytree(generated_backup, ROOT / "articulos")
                if IMAGE_DIR.exists():
                    shutil.rmtree(IMAGE_DIR)
                if images_backup.exists():
                    shutil.copytree(images_backup, IMAGE_DIR)
                raise
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


if __name__ == "__main__":
    main()
