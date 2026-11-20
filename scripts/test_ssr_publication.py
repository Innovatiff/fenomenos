#!/usr/bin/env python3
"""Local acceptance checks for the generated Firestore publication."""
import json
import re
import subprocess
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


class SSRPublication(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.articles = json.loads((ROOT / "data/published-articles.json").read_text())
        cls.routes = json.loads((ROOT / "data/article-routes.json").read_text())

    def test_every_published_article_has_static_route_and_content(self):
        self.assertGreater(len(self.articles), 0)
        self.assertEqual(len(self.articles), len(self.routes))
        for article in self.articles:
            page = ROOT / "articulos" / article["slug"] / "index.html"
            self.assertTrue(page.is_file(), article["slug"])
            text = page.read_text()
            self.assertIn(f'data-article-id="{article["id"]}"', text)
            self.assertIn("application/ld+json", text)
            self.assertIn(f'https://fenomenosmedia.org/articulos/{article["slug"]}/', text)
            self.assertNotIn("googlesyndication.com/pagead/js/adsbygoogle.js", text)
            self.assertRegex(text, r'<h1\b[^>]*>[^<\n].*</h1>')
            self.assertRegex(text, r'class="post__body"[^>]*>\s*\S')

    def test_index_and_sitemap_have_same_live_routes(self):
        index = (ROOT / "articulos.html").read_text()
        seed = json.loads(re.search(r'<script id="initial-articles" type="application/json">(.*?)</script>', index, re.S).group(1))
        seed_ids = {x["id"] for x in seed if not x.get("isArchive")}
        self.assertEqual(seed_ids, {x["id"] for x in self.articles})
        sitemap = (ROOT / "sitemap.xml").read_text()
        for article in self.articles:
            self.assertIn(f'<loc>https://fenomenosmedia.org/articulos/{article["slug"]}/</loc>', sitemap)

    def test_six_historical_archive_entries_remain_real_html(self):
        catalog = json.loads((ROOT / "archivo/catalog.json").read_text())
        for item in catalog[:6]:
            page = ROOT / item["path"].lstrip("/")
            self.assertTrue(page.is_file(), item["path"])
            text = page.read_text()
            self.assertRegex(text, r'<h1\b[^>]*>')
            self.assertNotIn("NO_STATIC_CONTENT", text)

    def test_empty_resolver_is_not_monetized_and_real_404_exists(self):
        resolver = (ROOT / "articulo.html").read_text()
        self.assertNotIn("googlesyndication.com/pagead/js/adsbygoogle.js", resolver)
        self.assertIn('meta name="robots" content="noindex"', (ROOT / "404.html").read_text())

    def test_invalid_publication_input_fails_before_writing_outputs(self):
        tracked = [ROOT / "articulos.html", ROOT / "index.html", ROOT / "sitemap.xml", ROOT / "data/published-articles.json"]
        before = {p: p.read_bytes() for p in tracked}
        with tempfile.NamedTemporaryFile("w", suffix=".json") as source:
            json.dump([{"id": "bad", "status": "published", "title": "Sin cuerpo"}], source)
            source.flush()
            result = subprocess.run(["python3", str(ROOT / "scripts/publish_firestore_articles.py"), "--source-json", source.name], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("has no truthful title/body", result.stderr)
        self.assertEqual(before, {p: p.read_bytes() for p in tracked})


if __name__ == "__main__":
    unittest.main()
