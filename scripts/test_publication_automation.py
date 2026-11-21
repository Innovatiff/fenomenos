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
