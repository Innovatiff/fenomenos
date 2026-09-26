"""Validate generated public archive without connecting to Firebase."""
import json,pathlib,re,xml.etree.ElementTree as ET
from html.parser import HTMLParser
ROOT=pathlib.Path(__file__).resolve().parents[1]
class Audit(HTMLParser):
 def __init__(self):super().__init__();self.h1=0;self.canonical=[];self.handlers=[]
 def handle_starttag(self,tag,attrs):
  attrs=dict(attrs)
  if tag=='h1':self.h1+=1
  if tag=='link' and attrs.get('rel')=='canonical':self.canonical.append(attrs.get('href'))
  self.handlers.extend(k for k in attrs if k.lower().startswith('on'))
items=json.loads((ROOT/'archivo/catalog.json').read_text());tree=ET.parse(ROOT/'sitemap.xml');urls=[e.text for e in tree.findall('.//{*}loc')];assert len(urls)==len(set(urls))
assert len({e['path'] for e in items})==len(items)
for item in items:
 text=(ROOT/item['path'].lstrip('/')).read_text();url='https://fenomenosdelcaribe.org'+item['path'];scan=Audit();scan.feed(text)
 assert scan.h1==1 and scan.canonical==[url],item['path']
 assert not scan.handlers,item['path']
 assert url in urls and 'noindex' not in text
 assert text.count('pagead2.googlesyndication.com/pagead/js/adsbygoogle.js')==1
 assert '/js/article-page.js' not in text
 schema=json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>',text,re.S)[1])
 assert schema['headline']==item['title'] and schema['datePublished']==item['date']
 assert '<iframe' not in text and 'TUENLACE' not in text and 'TULINK' not in text
assert (ROOT/'ads.txt').read_text().strip()=='google.com, pub-5012752012707398, DIRECT, f08c47fec0942fa0'
print(f'PASS: {len(items)} articles; unique paths, original dates, canonical, schema, sitemap, safe markup, one AdSense tag, ads.txt.')
