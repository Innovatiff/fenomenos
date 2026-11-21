#!/usr/bin/env python3
"""Static checks for the scheduled publication contract."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PublicationAutomation(unittest.TestCase):
    def test_workflow_polls_and_pushes_only_generated_changes(self):
        workflow = (ROOT / ".github/workflows/publish-firestore-articles.yml").read_text()
        self.assertIn('cron: "*/15 * * * *"', workflow)
        self.assertIn("python3 scripts/publish_firestore_articles.py", workflow)
        self.assertIn("git diff --quiet", workflow)
        self.assertIn("git push", workflow)
        self.assertIn("permissions:\n  contents: write", workflow)

    def test_netlify_build_generates_publication_and_keeps_hook_server_side(self):
        config = (ROOT / "netlify.toml").read_text()
        function = (ROOT / "netlify/functions/publish-articles.mjs").read_text()
        editor = (ROOT / "js/estudio.js").read_text()
        self.assertIn('command = "python3 scripts/publish_firestore_articles.py"', config)
        self.assertIn('functions = "netlify/functions"', config)
        self.assertIn("NETLIFY_BUILD_HOOK_URL", function)
        self.assertIn("identitytoolkit.googleapis.com", function)
        self.assertIn('fetch("/api/publish-articles"', editor)
        self.assertNotIn("NETLIFY_BUILD_HOOK_URL", editor)

    def test_generator_prunes_obsolete_generated_routes(self):
        generator = (ROOT / "scripts/publish_firestore_articles.py").read_text()
        self.assertIn("generated_root.glob(\"*/index.html\")", generator)
        self.assertIn("old_page.unlink()", generator)

    def test_target_domain_is_centralized(self):
        config = (ROOT / "config/site-migration.json").read_text()
        generator = (ROOT / "scripts/publish_firestore_articles.py").read_text()
        self.assertIn('"targetOrigin": "https://fenomenosmedia.org"', config)
        self.assertIn("CONFIG_ORIGIN", generator)

    def test_editor_requires_truthful_author_and_sources(self):
        editor = (ROOT / "estudio.html").read_text() + (ROOT / "js/estudio.js").read_text()
        self.assertIn('id="f-author"', editor)
        self.assertIn('id="f-sources"', editor)
        self.assertIn("Añade el autor verificado antes de publicar.", editor)
        self.assertIn("Añade al menos una fuente antes de publicar.", editor)


if __name__ == "__main__":
    unittest.main()
