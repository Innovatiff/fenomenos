#!/usr/bin/env python3
"""Build static archive from reviewed, sanitized local migration previews.
Source exports stay outside the repository. Run only with the reviewed selection.
"""
import argparse,html,json,pathlib,re,xml.etree.ElementTree as ET
from html.parser import HTMLParser
P=argparse.ArgumentParser();P.add_argument('--migration',required=True);a=P.parse_args()
R=pathlib.Path(__file__).resolve().parents[1];M=pathlib.Path(a.migration)
selection=json.loads((M/'publication-selection.json').read_text())
paths=[e['path'] for e in selection['candidates']]
records={e['path']:e for e in json.loads((M/'private-records.json').read_text()) if e['kind']=='POST'}
class Text(HTMLParser):
 def __init__(self):super().__init__();self.parts=[]
 def handle_data(self,s):self.parts.append(s)
origin='https://fenomenosdelcaribe.org'
health_path=M/'image-http-check.json'
health=json.loads(health_path.read_text()) if health_path.exists() else []
unavailable={x['url'] for x in health if x['status']!='200' or not x['contentType'].startswith('image/')}
overrides=json.loads((R/'tools/archive-image-overrides.json').read_text())
template=(R/'articulo.html').read_text()
# Retain existing navigation, mobile menu, styles, footer and common behavior.
template=re.sub(r'<script type="module" src="js/article-page.js"></script>','',template)
template=re.sub(r'(href|src)="(?!https?:|/|#)([^"]+)"',r'\1="/\2"',template)
start=template.index('<main id="contenido"');end=template.index('</main>',start)+7
items=[]
for path in paths:
 e=dict(records[path])
 title_overrides={'/2025/07/el-atlantico-comienza-activarse-tras.html':'El Atlántico comienza a activarse','/2019/01/una-tormenta-invernal-muy-potente-se.html':'Una tormenta invernal muy potente se está desarrollando sobre los Estados Unidos'}
 if path in title_overrides:e['title']=title_overrides[path]
 preview=(M/'preview'/path.lstrip('/')).read_text()
 body=preview[preview.index('<article class="post">'):preview.index('</article>')+10]
 if path in title_overrides:body=body.replace('<h1 class="post__title">Entrada sin título</h1>','<h1 class="post__title">'+html.escape(e['title'])+'</h1>')
 # Only rewrite links to selected pages. All other historic links remain at origin.
 body=re.sub(r'href="(/(?:20\d\d/|p/)[^"]*)"',lambda m:'href="'+(m[1] if m[1].split('#')[0].split('?')[0] in paths else 'https://www.huracanescaribe.com'+m[1])+'"',body)
 for original,replacement in overrides.items():
  body=body.replace(html.escape(original,quote=True),html.escape(replacement,quote=True))
 for unavailable_url in unavailable:
  escaped=html.escape(unavailable_url,quote=True)
  body=re.sub(r'<img\b[^>]*src="'+re.escape(escaped)+r'"[^>]*>', '<span class="archive-image-unavailable">Imagen del archivo original no disponible.</span>', body)
 t=Text();t.feed(e['html']);desc=re.sub(r'\s+',' ',' '.join(t.parts)).strip()[:155]
 url=origin+path
 note='<p class="archive-notice">Archivo de Huracanes Caribe · Publicado originalmente el '+html.escape(e['published'][:10])+'. Se conserva como material de consulta histórica. Para alertas vigentes, consulta las autoridades meteorológicas de tu país.</p>'
 main='<main id="contenido" class="post-page"><div class="post-shell"><a class="post__back" href="/archivo/">← Archivo de Huracanes Caribe</a>'+note+body+'</div></main>'
 page=template[:start]+main+template[end:]
 page=re.sub(r'<title>.*?</title>','<title>'+html.escape(e['title'])+' | Fenómenos del Caribe</title>',page,flags=re.S)
 page=re.sub(r'<meta\s+name="description".*?/>','<meta name="description" content="'+html.escape(desc,quote=True)+'" />',page,flags=re.S)
 schema={'@context':'https://schema.org','@type':'Article','headline':e['title'],'datePublished':e['published'],'dateModified':e['updated'],'author':{'@type':'Person','name':e['author']} if e['author']!='Huracanes Caribe' else {'@type':'Organization','name':e['author']},'mainEntityOfPage':url,'publisher':{'@type':'Organization','name':'Fenómenos del Caribe'},'isBasedOn':'https://www.huracanescaribe.com'+path}
 if not e['author']:schema.pop('author',None)
 meta='<link rel="canonical" href="'+url+'"><meta property="og:type" content="article"><meta property="og:title" content="'+html.escape(e['title'],quote=True)+'"><meta property="og:description" content="'+html.escape(desc,quote=True)+'"><meta property="og:url" content="'+url+'"><meta name="twitter:card" content="summary"><link rel="stylesheet" href="/css/archive.css"><script type="application/ld+json">'+json.dumps(schema,ensure_ascii=False).replace('<','\\u003c')+'</script>'
 page=page.replace('</head>',meta+'</head>')
 out=R/path.lstrip('/');out.parent.mkdir(parents=True,exist_ok=True);out.write_text(page)
 images=re.findall(r'<img[^>]+src="([^"]+)"',body)
 items.append({'path':path,'title':e['title'],'date':e['published'],'author':e['author'],'description':desc,'tags':e['tags'],'cover':html.unescape(images[0]) if images else ''})
# Static archive directory: search engines do not need Firebase or JavaScript.
listing='<main id="contenido" class="post-page"><div class="post-shell"><h1 class="post__title">Archivo de Huracanes Caribe</h1><p>Artículos y análisis de nuestro archivo, conservados con su autoría y fecha originales. Los pronósticos antiguos describen eventos pasados y no condiciones actuales.</p>'
for year in sorted({e['date'][:4] for e in items},reverse=True):
 listing+='<h2>Entradas · '+year+'</h2><ul class="archive-list">'
 for e in sorted((e for e in items if e['date'].startswith(year)),key=lambda e:e['date'],reverse=True):listing+='<li><time datetime="'+e['date']+'">'+e['date'][:10]+'</time><a href="'+e['path']+'">'+html.escape(e['title'])+'</a></li>'
 listing+='</ul>'
listing+='</div></main>'
index=template[:start]+listing+template[end:];index=re.sub(r'<title>.*?</title>','<title>Archivo de Huracanes Caribe | Fenómenos del Caribe</title>',index,flags=re.S)
index=index.replace('</head>','<link rel="canonical" href="'+origin+'/archivo/"><link rel="stylesheet" href="/css/archive.css"></head>')
(R/'archivo').mkdir(exist_ok=True);(R/'archivo/index.html').write_text(index)
# Add entries idempotently, preserving all pre-existing sitemap URLs.
ns='http://www.sitemaps.org/schemas/sitemap/0.9';ET.register_namespace('',ns);tree=ET.parse(R/'sitemap.xml');root=tree.getroot();old_paths={e['path'] for e in json.loads((M/'manifest.json').read_text()) if e['kind']=='POST'}
for node in list(root):
 loc=node.find('{'+ns+'}loc')
 if loc is not None and loc.text in {origin+p for p in old_paths}:root.remove(node)
existing={n.text for n in root.findall('{'+ns+'}url/{'+ns+'}loc')}
for url in [origin+'/archivo/']+[origin+p for p in paths]:
 if url not in existing:ET.SubElement(ET.SubElement(root,'{'+ns+'}url'),'{'+ns+'}loc').text=url
ET.indent(tree);tree.write(R/'sitemap.xml',encoding='utf-8',xml_declaration=True)
(R/'archivo/catalog.json').write_text(json.dumps(items,ensure_ascii=False,indent=2))
print('Built',len(items),'archive articles plus directory; original URLs preserved.')
