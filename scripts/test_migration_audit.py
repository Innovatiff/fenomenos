"""Focused tests for audit parsing/classification primitives (no network)."""
import pathlib,tempfile,unittest
from migration_audit import Doc,site_path,safe_public,robots
class MigrationAuditTests(unittest.TestCase):
 def test_duplicate_canonicals_and_body_only(self):
  d=Doc('<head><link rel="canonical" href="https://fenomenosdelcaribe.org/a"><link rel="canonical" href="/a"></head><nav>menu</nav><div class="post__text"><p>Texto real</p><script>alert(1)</script></div>')
  self.assertEqual(len(d.canon()),2);self.assertEqual(d.body().text(),'Texto real')
 def test_jsonld_and_invalid_json(self):
  d=Doc('<script type="application/ld+json">{"@type":"Article","headline":"Texto"}</script><script type="application/ld+json">bad</script>')
  schemas,errors=d.schemas();self.assertEqual(schemas[0]['headline'],'Texto');self.assertEqual(len(errors),1)
 def test_path_mapping_and_traversal(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=pathlib.Path(tmp).resolve();(p/'archivo').mkdir();(p/'archivo/index.html').write_text('ok');(p/'articulos.html').write_text('ok')
   self.assertEqual(site_path(p,'/archivo/'),p/'archivo/index.html');self.assertEqual(site_path(p,'/articulos'),p/'articulos.html');self.assertIsNone(site_path(p,'/%2e%2e/outside.html'))
 def test_public_image_scope(self):
  for u in ['file:///etc/passwd','http://127.0.0.1/a','http://169.254.169.254/a','https://user:pass@example.org/a','javascript:alert(1)']:self.assertFalse(safe_public(u))
  self.assertTrue(safe_public('https://blogger.googleusercontent.com/img/a.png'))
 def test_robots_disallow(self):
  r=robots('User-agent: *\nDisallow: /private/\nAllow: /')
  self.assertFalse(r.can_fetch('Googlebot','https://example.org/private/a'));self.assertTrue(r.can_fetch('Googlebot','https://example.org/a'))
if __name__=='__main__':unittest.main()
