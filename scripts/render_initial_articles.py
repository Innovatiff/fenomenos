"""Build crawlable article cards from the real local archive; no network required."""
import json,re
from pathlib import Path
from html import escape as e
ROOT=Path(__file__).resolve().parents[1]
# The Firestore publication step owns the public indexes when a live manifest
# exists.  Do not let the archive-only compatibility generator erase them.
if (ROOT/'data/published-articles.json').exists():
 print('Firestore publication manifest present; indexes already owned by publish_firestore_articles.py')
 raise SystemExit(0)
rows=sorted(json.loads((ROOT/'archivo/catalog.json').read_text()),key=lambda x:x['date'],reverse=True)
for filename,grid_id,limit in [('articulos.html','articles-grid',48),('index.html','home-articles',4)]:
 selected=rows[:limit];cards=[];seed=[]
 for r in selected:
  assert (ROOT/r['path'].lstrip('/')).is_file(),r['path']
  seed.append(dict(id='archive:'+r['path'],archivePath=r['path'],isArchive=True,title=r['title'],excerpt=r['description'],publishedAt=r['date'],cover=r.get('cover',''),tags=['Archivo',*r.get('tags',[])],categories=r.get('categories',[])))
  img=f'<img src="{e(r["cover"],quote=True)}" alt="" loading="lazy" />' if r.get('cover') else ''
  cards.append(f'<li class="card card--article"><a class="card__inner" href="{e(r["path"])}"><span class="article__media">{img}</span><span class="article__meta">Archivo · <time datetime="{e(r["date"])}">{r["date"][:10]}</time></span><h3 class="card__title">{e(r["title"])}</h3><p class="card__text">{e(r["description"])}</p><span class="card__link">Leer más →</span></a></li>')
 p=ROOT/filename;s=p.read_text();s=re.sub(r'(<ul[^>]*id="'+grid_id+r'"[^>]*>).*?(</ul>)',lambda m:m[1]+'\n'+'\n'.join(cards)+'\n'+m[2],s,count=1,flags=re.S)
 s=re.sub(r'\s*<!-- Watchdog:.*?</script>','',s,flags=re.S)
 s=re.sub(r'<script id="initial-articles" type="application/json">.*?</script>\s*','',s,flags=re.S)
 payload=json.dumps(seed,ensure_ascii=False).replace('<','\\u003c')
 s=s.replace('</body>','<script id="initial-articles" type="application/json">'+payload+'</script>\n  </body>');p.write_text(s)
 print(filename,len(cards),'real linked cards')
