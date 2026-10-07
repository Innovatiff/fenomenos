import unittest,re,json
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[1]
class InitialArticles(unittest.TestCase):
 def test_source_links_and_seed(self):
  for name,id,count in [('articulos.html','articles-grid',48),('index.html','home-articles',4)]:
   s=(ROOT/name).read_text();grid=re.search(r'<ul[^>]*id="'+id+r'"[^>]*>(.*?)</ul>',s,re.S)[1]
   links=re.findall(r'href="([^"]+)"',grid)
   self.assertEqual(len(links),count);self.assertEqual(len(set(links)),count)
   self.assertNotIn('skeleton',grid);self.assertNotIn(' reveal',grid)
   for link in links:self.assertTrue((ROOT/link.lstrip('/')).is_file())
   seed=json.loads(re.search(r'<script id="initial-articles" type="application/json">(.*?)</script>',s,re.S)[1])
   self.assertEqual(links,[x['archivePath'] for x in seed])
   self.assertNotIn('grid.textContent = ""',s)
 def test_generator_repeatable(self):
  import subprocess
  before=[(ROOT/x).read_bytes() for x in ['index.html','articulos.html']]
  subprocess.run(['python3',str(ROOT/'scripts/render_initial_articles.py')],check=True,capture_output=True)
  self.assertEqual(before,[(ROOT/x).read_bytes() for x in ['index.html','articulos.html']])
if __name__=='__main__':unittest.main()
