"""Check visible products agree with the server-rendered structured data."""
import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(); self.images=[]; self.links=[]; self.text=[]; self.feed(html)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='img': self.images.append(a)
        if tag=='a': self.links.append(a.get('href'))
    def handle_data(self,data): self.text.append(data)
class CatalogTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html=(ROOT/'tienda/index.html').read_text()
        cls.data=json.loads((ROOT/'data/shop-catalog.json').read_text())
        cls.schema=json.loads(re.search(r'<script type="application/ld\+json" id="shop-catalog-schema">(.*?)</script>',cls.html,re.S)[1])
        cls.visible=Page(cls.html.split('<!-- SHOP-CATALOG:START -->')[1].split('<!-- SHOP-CATALOG:END -->')[0])
    def test_count_and_unique_urls(self):
        items=self.schema['itemListElement']
        self.assertEqual(len(items),len(self.data['products']))
        self.assertEqual(self.schema['numberOfItems'],len(items))
        self.assertEqual(len({x['item']['url'] for x in items}),len(items))
    def test_products_match_visible_content_and_verified_data(self):
        text=' '.join(self.visible.text)
        for pos,(entry,source) in enumerate(zip(self.schema['itemListElement'],self.data['products']),1):
            self.assertEqual(entry['position'],pos)
            p=entry['item'];offer=p['offers']
            self.assertEqual(p['@type'],'Product')
            self.assertIn(p['name'],text);self.assertIn(p['description'],text)
            self.assertEqual(p['brand']['name'],'Fenómenos Media')
            self.assertEqual(offer['price'],source['price']);self.assertEqual(offer['priceCurrency'],'USD')
            self.assertIn('US$'+offer['price'],text)
            self.assertEqual(offer['availability'],source['availability'])
            self.assertIn('is in stock',source['availabilityEvidence'])
            self.assertEqual(offer['url'],source['url']);self.assertIn(offer['url'],self.visible.links)
            self.assertTrue(any(img['src']==p['image'] and img.get('alt') for img in self.visible.images))
    def test_indexability_and_semantics(self):
        self.assertIn('name="robots" content="index, follow"',self.html)
        self.assertIn('rel="canonical" href="https://fenomenosdelcaribe.org/tienda/"',self.html)
        self.assertEqual(self.html.count('<h1>'),1)
        self.assertIn('https://fenomenosdelcaribe.org/tienda/',(ROOT/'sitemap.xml').read_text())
        self.assertNotIn('Est 2017',' '.join(self.visible.text))
if __name__=='__main__':unittest.main()
