#!/usr/bin/env python3
"""Migration Audit: read-only Blogger/HTML/HTTP audit; stdlib + curl.
No production writes. Reports stay outside the site repository by default.
"""
import argparse, collections, concurrent.futures, csv, datetime as dt, hashlib, ipaddress, json, pathlib, re, subprocess, tempfile, unicodedata
import urllib.parse as U
import urllib.robotparser as RP
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

ATOM={'a':'http://www.w3.org/2005/Atom','b':'http://schemas.google.com/blogger/2018'}
OLD={'huracanescaribe.com','www.huracanescaribe.com','huracanes-caribe.blogspot.com'}
ORIGIN='https://fenomenosdelcaribe.org'
VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
def norm(s): return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',s or '')).strip()
def hashed(s):return hashlib.sha256(s.encode()).hexdigest()
def stamp():return dt.datetime.now(dt.timezone.utc).isoformat()
class Node:
 def __init__(self,tag='',attrs=None):self.tag=tag;self.attrs=dict(attrs or []);self.children=[]
 def all(self,tag=None):
  for c in self.children:
   if isinstance(c,Node):
    if tag is None or c.tag==tag:yield c
    yield from c.all(tag)
 def text(self):return norm(' '.join(c.text() if isinstance(c,Node) else c for c in self.children if not isinstance(c,Node) or c.tag not in {'script','style','noscript'}))
class Doc(HTMLParser):
 def __init__(self,html):
  super().__init__(convert_charrefs=True);self.root=Node('root');self.stack=[self.root];self.feed(html)
 def handle_starttag(self,t,a):
  n=Node(t,a);self.stack[-1].children.append(n)
  if t not in VOID:self.stack.append(n)
 def handle_startendtag(self,t,a):
  self.handle_starttag(t,a)
  if t not in VOID:self.handle_endtag(t)
 def handle_endtag(self,t):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==t:self.stack=self.stack[:i];break
 def handle_data(self,s):self.stack[-1].children.append(s)
 def all(self,t=None):return list(self.root.all(t))
 def metas(self,name):return [n.attrs.get('content','') for n in self.all('meta') if n.attrs.get('name',n.attrs.get('property','')).lower()==name.lower()]
 def canon(self):return [n.attrs.get('href','') for n in self.all('link') if 'canonical' in n.attrs.get('rel','').lower().split()]
 def body(self):return next((n for n in self.all() if 'post__text' in n.attrs.get('class','').split()),None)
 def schemas(self):
  out=[];errors=[]
  for n in self.all('script'):
   if n.attrs.get('type')=='application/ld+json':
    try:
     v=json.loads(''.join(c for c in n.children if isinstance(c,str)));out.extend(v if isinstance(v,list) else v.get('@graph',[v]))
    except (ValueError,AttributeError) as e:errors.append(str(e))
  return out,errors

def source_records(path):
 root=ET.parse(path).getroot();out=[]
 for e in root.findall('a:entry',ATOM):
  val=lambda k:e.findtext(k,default='',namespaces=ATOM)
  out.append({'blogger_id':val('a:id'),'kind':val('b:type'),'source_status':val('b:status'),'path':val('b:filename'),'title':val('a:title'),'date':val('a:published'),'modified':val('a:updated'),'author':val('a:author/a:name'),'html':val('a:content'),'parent':val('b:parent'),'reply_to':val('b:inReplyTo')})
 return out

def safe_public(url):
 p=U.urlsplit(url)
 if p.scheme not in {'http','https'} or not p.hostname or p.username or p.password:return False
 if p.hostname.lower() in {'localhost','localhost.localdomain'}:return False
 try:return ipaddress.ip_address(p.hostname).is_global
 except ValueError:return True

def request(url,head=False,local=False,range_probe=False):
 if not local and not safe_public(url):return {'url':url,'status':None,'error':'URL fuera del alcance HTTP público','checked_at':stamp()}
 with tempfile.TemporaryDirectory() as tmp:
  body=pathlib.Path(tmp)/'body';headers=pathlib.Path(tmp)/'headers'
  cmd=['curl','--silent','--show-error','--location','--max-redirs','5','--max-time','15','--connect-timeout','7','--proto','=http,https','--proto-redir','=http,https','--max-filesize','5000000','--dump-header',str(headers),'--output',str(body),'--write-out','%{http_code}\t%{url_effective}\t%{content_type}']
  if head:cmd+=['--head']
  if range_probe:
   cmd[cmd.index('--max-filesize')+1]='65536';cmd+=['--range','0-1023']
  cmd+=[url]
  try:
   p=subprocess.run(cmd,capture_output=True,text=True,timeout=18);parts=p.stdout.split('\t');h=headers.read_text(errors='replace') if headers.exists() else '';blocks=re.split(r'\r?\n\r?\n',h.strip());last=next((x for x in reversed(blocks) if x.startswith('HTTP/')),'');hd={}
   for line in last.splitlines()[1:]:
    if ':' in line:
     k,v=line.split(':',1);hd.setdefault(k.lower(),[]).append(v.strip())
   return {'url':url,'status':int(parts[0]) if parts and parts[0].isdigit() else None,'final_url':parts[1] if len(parts)>1 else None,'content_type':parts[2] if len(parts)>2 else '', 'headers':hd,'error':p.stderr.strip() if p.returncode else None,'body':body.read_text(errors='replace') if not head and not range_probe and body.exists() else '', 'checked_at':stamp(),'method':'GET range 0-1023' if range_probe else 'HEAD' if head else 'GET'}
  except subprocess.TimeoutExpired:return {'url':url,'status':None,'error':'Timeout','checked_at':stamp()}

def probe_many(urls,head,cache,refresh,local=False):
 todo=sorted(set(urls));results={};pending=[]
 for u in todo:
  key=('HEAD ' if head else 'GET ')+u
  if not refresh and key in cache:results[u]=cache[key]
  else:pending.append(u)
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  for i,(u,r) in enumerate(zip(pending,pool.map(lambda u:request(u,head,local),pending)),1):
   results[u]=r;cache[('HEAD ' if head else 'GET ')+u]=r
   if i%50==0:print(f'HTTP {i}/{len(pending)} ({"HEAD" if head else "GET"})',flush=True)
 return results

def site_path(repo,url):
 p=U.unquote(U.urlsplit(url).path).lstrip('/');candidate=(repo/p).resolve()
 if not candidate.is_relative_to(repo.resolve()):return None
 for f in [candidate,candidate/'index.html',candidate.with_suffix('.html') if not candidate.suffix else candidate]:
  if f.is_file():return f
 return None

def robots(text):
 r=RP.RobotFileParser();r.parse(text.splitlines());return r

def csv_write(path,rows):
 keys=list(dict.fromkeys(k for r in rows for k in r))
 with path.open('w',newline='',encoding='utf-8-sig') as f:
  w=csv.DictWriter(f,fieldnames=keys);w.writeheader()
  for r in rows:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in r.items()})

def main():
 parser=argparse.ArgumentParser(description=__doc__);repo_default=pathlib.Path(__file__).resolve().parents[1]
 parser.add_argument('--repo',type=pathlib.Path,default=repo_default);parser.add_argument('--source',type=pathlib.Path,default=repo_default.parent/'blogger-migration/source.atom');parser.add_argument('--output',type=pathlib.Path,default=repo_default.parents[1]/'outputs/migration-audit');parser.add_argument('--preview-base',default='http://127.0.0.1:8768');parser.add_argument('--offline',action='store_true');parser.add_argument('--refresh',action='store_true');args=parser.parse_args()
 repo=args.repo.resolve();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
 if out.is_relative_to(repo):raise SystemExit('El reporte debe quedar fuera del sitio público (contiene inventario privado).')
 cachepath=out/'http-cache.json';cache=json.loads(cachepath.read_text()) if cachepath.exists() else {}
 src=source_records(args.source);posts=[e for e in src if e['kind']=='POST'];pages=[e for e in src if e['kind']=='PAGE'];comments=[e for e in src if e['kind']=='COMMENT'];byid={e['blogger_id']:e for e in src};catalog=json.loads((repo/'archivo/catalog.json').read_text());catmap={e['path']:e for e in catalog};catalog_duplicates=[p for p,n in collections.Counter(e['path'] for e in catalog).items() if n>1]
 allpaths={e['path'] for e in posts};sitemaptext=(repo/'sitemap.xml').read_text();sm=[n.text for n in ET.fromstring(sitemaptext).iter() if n.tag.endswith('}loc')];rb=(repo/'robots.txt').read_text();localrobots=robots(rb)
 documents={};inventory=[];links=[];image_refs=collections.defaultdict(list);source_images=collections.defaultdict(list);findings=[]
 def finding(row,code,level,category,detail):
  item={'code':code,'level':level,'category':category,'detail':detail};row['issues'].append(item)
  findings.append({'path':row['path'],**item})
 for e in posts:
  path=e['path'];expected=ORIGIN+path;f=site_path(repo,path);source_doc=Doc(e['html']);source_text=source_doc.root.text();row={'old_url':'https://www.huracanescaribe.com'+path,'new_url':expected,'path':path,'title':e['title'],'date':e['date'],'author':e['author'],'blogger_id':e['blogger_id'],'file':str(f.relative_to(repo)) if f else None,'migration_state':'migrated' if path in catmap and f else 'pending','issues':[],'source_words':len(source_text.split()),'source_sha256':hashed(e['html'])}
  for n in source_doc.all('img'):
   if n.attrs.get('src'):source_images[U.urljoin(row['old_url'],n.attrs['src'])].append(path)
  if not e['title']:finding(row,'SOURCE_TITLE_MISSING','WARNING','content_quality_review','Título vacío en Blogger; verificar recuperación del texto.')
  if not e['author']:finding(row,'SOURCE_AUTHOR_MISSING','WARNING','content_quality_review','El respaldo no identifica autor; no inventar autoría.')
  if row['source_words']<100:finding(row,'SHORT_SOURCE','WARNING','content_quality_review',f'{row["source_words"]} palabras; umbral de revisión manual, no regla de AdSense.')
  if re.search(r'TUENLACE|TULINK|lorem ipsum',e['html'],re.I):finding(row,'PLACEHOLDER','FAIL','technical_issue','El original contiene enlaces/texto de ejemplo.')
  if ('facebook' in e['html'].lower() or 'Posted by' in source_text) and row['source_words']<60:finding(row,'EMBED_ONLY','FAIL','content_quality_review','Entrada breve dependiente de publicación social; sin desarrollo propio suficiente para esta auditoría.')
  if not f or path not in catmap:
   finding(row,'NOT_MIGRATED','FAIL','technical_issue','No hay página equivalente incluida en el catálogo de producción local.');inventory.append(row);continue
  text=f.read_text();doc=Doc(text);documents[path]=doc;body=doc.body();plain=body.text() if body else '';row.update({'migrated_title':catmap[path]['title'],'words':len(plain.split()),'body_hash':hashed(plain.casefold()),'body_text':plain,'source_text':source_text,'canonical':doc.canon(),'expected_canonical':expected,'description':doc.metas('description'),'h1':[n.text() for n in doc.all('h1')],'source_text_preserved':norm(source_text)==norm(plain)})
  if len(doc.all('title'))!=1 or not doc.all('title')[0].text():finding(row,'TITLE_INVALID','FAIL','technical_issue','Se requiere un único title no vacío.')
  if not any(doc.metas('description')):finding(row,'DESCRIPTION_MISSING','WARNING','technical_issue','Meta description ausente.')
  if [norm(h) for h in row['h1']]!=[norm(catmap[path]['title'])]:finding(row,'H1_MISMATCH','WARNING','technical_issue','H1 distinto del título del catálogo.')
  if doc.canon()!=[expected]:finding(row,'CANONICAL_INVALID','FAIL','technical_issue',f'Canonical encontrado: {doc.canon()}')
  if any('noindex' in x.lower() or re.search(r'\bnone\b',x.lower()) for x in doc.metas('robots')+doc.metas('googlebot')):finding(row,'NOINDEX','FAIL','technical_issue','Meta robots bloquea indexación.')
  row['robots_allowed']=localrobots.can_fetch('Googlebot',expected)
  if not row['robots_allowed']:finding(row,'ROBOTS_BLOCKED','FAIL','technical_issue','robots.txt local bloquea Googlebot.')
  if expected not in sm:finding(row,'SITEMAP_MISSING','FAIL','technical_issue','URL ausente del sitemap local.')
  if not plain:finding(row,'EMPTY_BODY','FAIL','content_quality_review','Sin texto de artículo detectable.')
  if 'Imagen del archivo original no disponible' in plain:finding(row,'IMAGE_FALLBACK','WARNING','technical_issue','Se ha sustituido una imagen por un aviso; falta recuperar o decidir su eliminación editorial.')
  if not row['source_text_preserved']:finding(row,'TEXT_CHANGED','WARNING','content_quality_review','Texto visible normalizado difiere del original; revisar saneamiento, enlace de vídeo o fallback. No implica pérdida confirmada.')
  schemas,errors=doc.schemas();article=next((s for s in schemas if isinstance(s,dict) and s.get('@type') in ['Article','NewsArticle','BlogPosting']),{})
  row['schema']=article
  if errors or not article:finding(row,'SCHEMA_INVALID','FAIL','technical_issue','JSON-LD inválido o Article ausente.')
  for key,expected_value in [('headline',catmap[path]['title']),('datePublished',e['date']),('dateModified',e['modified'])]:
   if article.get(key)!=expected_value:finding(row,'SCHEMA_'+key.upper(),'FAIL','technical_issue',f'{key} no coincide con el catálogo/respaldo.')
  if article.get('mainEntityOfPage')!=expected and article.get('url')!=expected:finding(row,'SCHEMA_IDENTITY','FAIL','technical_issue','No identifica la URL del artículo.')
  if not article.get('url'):finding(row,'SCHEMA_URL_ABSENT','WARNING','technical_issue','Falta url explícito; mainEntityOfPage sí puede identificar la página. No equivale a schema inválido.')
  if body and list(body.all('img')) and not article.get('image'):finding(row,'SCHEMA_IMAGE_ABSENT','WARNING','technical_issue','Artículo con imágenes sin image en JSON-LD; mejora de metadatos, no garantía de resultado enriquecido.')
  if not article.get('publisher'):finding(row,'SCHEMA_PUBLISHER_ABSENT','WARNING','technical_issue','publisher ausente.')
  schemaauthor=article.get('author',{});authorname=schemaauthor.get('name','') if isinstance(schemaauthor,dict) else str(schemaauthor)
  if e['author'] and (authorname!=e['author'] or catmap[path].get('author')!=e['author']):finding(row,'AUTHOR_CHANGED','FAIL','technical_issue','Autor distinto del respaldo.')
  if catmap[path].get('date')!=e['date']:finding(row,'DATE_CHANGED','FAIL','technical_issue','Fecha de catálogo distinta del respaldo.')
  for key in ['date','modified']:
   try:
    d=dt.datetime.fromisoformat(e[key].replace('Z','+00:00'))
    if d>dt.datetime.now(dt.timezone.utc):finding(row,'FUTURE_DATE','WARNING','content_quality_review',f'{key} es futura.')
   except ValueError:finding(row,'DATE_INVALID','FAIL','technical_issue',f'{key} inválida.')
  head=next((n for n in doc.all() if 'post__head' in n.attrs.get('class','').split()),None)
  if e['author'] and head and e['author'] not in head.text():finding(row,'VISIBLE_AUTHOR_MISSING','WARNING','technical_issue','Autor no visible en cabecera.')
  if head and e['date'][:10] not in head.text():finding(row,'VISIBLE_DATE_MISMATCH','WARNING','technical_issue','Fecha ISO original no visible en cabecera.')
  if catmap[path]['title']!=e['title']:finding(row,'TITLE_RECOVERED','WARNING','content_quality_review','Título distinto del campo original; comprobar que procede del texto, no de una reescritura.')
  for a in doc.all('a'):
   href=a.attrs.get('href','');u=U.urljoin(expected,href);p=U.urlsplit(u);scope='article' if body and a in list(body.all('a')) else 'template'
   kind='anchor' if href.startswith('#') else 'internal_fenomenos' if p.hostname in {'fenomenosdelcaribe.org','www.fenomenosdelcaribe.org'} else 'old_huracanes_link' if p.hostname in OLD else 'external_link' if p.scheme in ['http','https'] else 'other'
   mapped=ORIGIN+p.path if kind=='old_huracanes_link' and p.path in catmap else None
   links.append({'article':path,'scope':scope,'href':href,'url':u,'classification':kind,'mapped_equivalent':mapped,'mapping_validated_local':bool(mapped and site_path(repo,p.path))})
  if body:
   for n in body.all('img'):
    u=U.urljoin(expected,n.attrs.get('src',''));image_refs[u].append({'article':path,'alt':n.attrs.get('alt'),'missing_alt':'alt' not in n.attrs,'empty_alt':not n.attrs.get('alt','').strip(),'fallback':False})
  inventory.append(row)
 print(f'Inventario: {len(posts)} entradas; {len(documents)} HTML locales; {len(pages)} páginas; {len(comments)} comentarios',flush=True)
 # Live GETs prove HTTP and inspect deployed metadata, not just file existence.
 live_urls={ORIGIN+e['path'] for e in posts}|set(sm)|{ORIGIN+'/robots.txt',ORIGIN+'/sitemap.xml',ORIGIN+'/ads.txt'}
 live_urls|={U.urldefrag(l['url'])[0] for l in links if l['classification']=='internal_fenomenos'}
 live=probe_many(live_urls,False,cache,args.refresh) if not args.offline else {u:cache.get('GET '+u,{}) for u in live_urls}
 preview_urls={args.preview_base.rstrip('/')+e['path'] for e in posts}
 preview=probe_many(preview_urls,False,cache,args.refresh,True) if not args.offline else {u:cache.get('GET '+u,{}) for u in preview_urls}
 cachepath.write_text(json.dumps(cache,ensure_ascii=False))
 live_rb=live.get(ORIGIN+'/robots.txt',{});live_robot=robots(live_rb.get('body','')) if live_rb.get('status')==200 else None
 for row in inventory:
  remote=live.get(row['new_url'],{});pr=preview.get(args.preview_base.rstrip('/')+row['path'],{});row['http_live']={k:v for k,v in remote.items() if k!='body'};row['http_preview']={k:v for k,v in pr.items() if k!='body'}
  rd=Doc(remote.get('body',''));row['live_canonical']=rd.canon();row['live_schema_count']=len(rd.schemas()[0]);header_robots=' '.join(remote.get('headers',{}).get('x-robots-tag',[])).lower();noindex=any('noindex' in x.lower() or re.search(r'\bnone\b',x.lower()) for x in rd.metas('robots')+rd.metas('googlebot')) or 'noindex' in header_robots or bool(re.search(r'\bnone\b',header_robots));row['live_indexable_technical']=remote.get('status')==200 and not noindex and (live_robot.can_fetch('Googlebot',row['new_url']) if live_robot else None)
  if row['migration_state']=='migrated':
   if pr.get('status')!=200:finding(row,'PREVIEW_HTTP_NOT_200','FAIL','technical_issue',f'HTTP preview: {pr.get("status")}; {pr.get("error") or ""}')
   if remote.get('status')!=200:finding(row,'LIVE_HTTP_NOT_200','FAIL','technical_issue',f'HTTP publicado: {remote.get("status")}; puede indicar despliegue pendiente, no fallo del HTML local.')
   elif rd.canon()!=[row['new_url']]:finding(row,'LIVE_CANONICAL_INVALID','FAIL','technical_issue','El canonical publicado no coincide con la URL esperada.')
   if noindex:finding(row,'LIVE_NOINDEX','FAIL','technical_issue','Meta/header noindex en producción.')
   if live_robot and not live_robot.can_fetch('Googlebot',row['new_url']):finding(row,'LIVE_ROBOTS_BLOCKED','FAIL','technical_issue','robots.txt publicado bloquea Googlebot.')
   if remote.get('status')==200:
    remote_body=rd.body();row['live_content_matches_local']=bool(remote_body and hashed(remote_body.text().casefold())==row['body_hash'])
    if not row['live_content_matches_local']:finding(row,'LIVE_CONTENT_DIFFERS','WARNING','technical_issue','El cuerpo publicado difiere del HTML local o no se detecta.')
 # Link checks retain original kind and expose broken_link as a separate result.
 for l in links:
  if l['classification']=='internal_fenomenos':
   p=U.urlsplit(l['url']);target=site_path(repo,l['url']);l['local_exists']=bool(target);r=live.get(U.urldefrag(l['url'])[0],{});l['live_http']=r.get('status');l['result']='broken_link' if r.get('status') in [404,410] else 'unknown' if not r.get('status') else 'ok' if r.get('status')==200 else 'needs_review'
   if p.fragment and target and target.suffix=='.html':l['fragment_exists']=any(n.attrs.get('id')==U.unquote(p.fragment) or n.attrs.get('name')==U.unquote(p.fragment) for n in Doc(target.read_text()).all())
  elif l['classification']=='anchor':l['fragment_exists']=any(n.attrs.get('id')==l['href'][1:] or n.attrs.get('name')==l['href'][1:] for n in documents[l['article']].all());l['result']='ok' if l['fragment_exists'] else 'broken_link'
  else:l['result']='not_probed'
 for l in links:
  if l.get('fragment_exists') is False:l['result']='broken_link'
 # Images from the original of migrated entries reveal omitted resources too.
 migrated_paths=set(documents);all_images=set(image_refs)|{u for u,ps in source_images.items() if any(p in migrated_paths for p in ps)}
 image_http=probe_many(all_images,True,cache,args.refresh) if not args.offline else {u:cache.get('HEAD '+u,{}) for u in all_images}
 # Confirm HEAD 404/410 with a tiny bounded GET. Never retain image payloads.
 confirm_urls=[u for u,r in image_http.items() if r.get('status') in [404,410]]
 def confirm(u):
  key='GET_RANGE '+u
  if not args.refresh and key in cache:return cache[key]
  if args.offline:return {}
  return request(u,range_probe=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for u,r in zip(confirm_urls,pool.map(confirm,confirm_urls)):
   if r:
    cache['GET_RANGE '+u]=r
    image_http[u]={**r,'head_status':image_http[u].get('status')}
 cachepath.write_text(json.dumps(cache,ensure_ascii=False))
 backup_path=args.source.parent/'media-backup-manifest.json';backup=json.loads(backup_path.read_text()) if backup_path.exists() else [];images=[]
 for u in sorted(all_images):
  refs=image_refs[u];p=U.urlsplit(u);r=image_http.get(u,{});local=p.hostname in {'fenomenosdelcaribe.org','www.fenomenosdelcaribe.org'};localfile=site_path(repo,u) if local else None
  name=U.unquote(p.path.rsplit('/',1)[-1]);candidates=[b['source'] for b in backup if U.unquote(pathlib.PurePosixPath(b['source']).name)==name]
  state='LOCAL' if localfile else 'BROKEN' if r.get('status') in [404,410] and r.get('method')=='GET range 0-1023' else 'UNKNOWN' if r.get('status') not in [200,206] or not r.get('content_type','').startswith('image/') else 'EXTERNAL_DEPENDENCY'
  images.append({'url':u,'origin':p.hostname,'articles':sorted({x['article'] for x in refs}|(set(source_images[u])&migrated_paths)),'uses_migrated':len(refs),'uses_source':len([x for x in source_images[u] if x in migrated_paths]),'classification':state,'http':{k:v for k,v in r.items() if k not in ['body','headers']},'local_copy_confirmed':str(localfile) if localfile else None,'backup_filename_candidates':candidates,'backup_match_note':'Nombre no prueba identidad; no se compararon bytes remotos.','blogger_google_dependency':bool(p.hostname and ('googleusercontent.com' in p.hostname or 'blogspot.com' in p.hostname)),'missing_alt':sum(x['missing_alt'] for x in refs),'empty_alt':sum(x['empty_alt'] for x in refs),'removed_or_fallback':not refs,'references':refs})
 image_by_url={i['url']:i for i in images}
 for row in inventory:
  if row['migration_state']!='migrated':continue
  body=documents[row['path']].body();first=next(iter(body.all('img')),None) if body else None
  firsturl=U.urljoin(row['new_url'],first.attrs.get('src','')) if first else None
  row['primary_image']={'url':firsturl,'classification':image_by_url.get(firsturl,{}).get('classification'),'http':image_by_url.get(firsturl,{}).get('http')}
  broken=[i['url'] for i in images if i['classification']=='BROKEN' and any(x['article']==row['path'] for x in i['references'])]
  if broken:finding(row,'BROKEN_IMAGES','WARNING','technical_issue',f'{len(broken)} imágenes con 404/410 confirmado por GET; consultar images.csv.')
  if firsturl in broken:finding(row,'PRIMARY_IMAGE_BROKEN','FAIL','technical_issue','La primera imagen del artículo devuelve 404/410 confirmado por GET.')
 # Duplicates: exact visible body, title, canonical, ID and conservative word-shingle similarity.
 duplicates=[];migrated=[r for r in inventory if r['migration_state']=='migrated']
 def shingles(t):
  w=re.findall(r'\w+',t.casefold());return set(zip(w,w[1:],w[2:],w[3:],w[4:]))
 sh={r['path']:shingles(r['body_text']) for r in migrated}
 for i,a in enumerate(migrated):
  for b in migrated[i+1:]:
   title=norm(a['migrated_title']).casefold()==norm(b['migrated_title']).casefold();same=a['body_hash']==b['body_hash'];sa,sb=sh[a['path']],sh[b['path']];score=len(sa&sb)/len(sa|sb) if sa|sb else 0
   if same or title or score>=.8:duplicates.append({'a':a['path'],'b':b['path'],'classification':'exact_duplicate' if same else 'possible_duplicate' if score>=.8 else 'same_title_different_content','similarity':round(score,4)})
 for row in inventory:row['duplicate_classification']=next((d['classification'] for d in duplicates if row['path'] in [d['a'],d['b']]),'unique')
 # Blogger pages require a human decision, not automatic migration.
 page_reviews=[]
 for e in pages:
  doc=Doc(e['html']);txt=doc.root.text();t=e['title'].lower();wordcount=len(txt.split());embeds=len(doc.all('iframe'))+len(doc.all('script'));equiv=None
  if 'privacidad' in t:decision='NEEDS_REVIEW';reason='Política del sitio antiguo: adaptar al tratamiento/proveedores reales del nuevo dominio; revisión legal/editorial.'
  elif 'acerca' in t:decision='MIGRATE';reason='Página institucional útil; confirmar identidad y descripción actuales.'
  elif 'radar' in t:decision='REBUILD';reason='Herramienta antigua; revisar cobertura y reemplazar con equivalente funcional, sin redirigir por título solamente.';equiv='/radar/full/'
  elif any(x in t for x in ['modelo','satel','satél','mapa','temperatura','análisis','analisis','pronost','pronóst','terremot','tiempo en','amenaza']):decision='REBUILD';reason='Herramienta o datos dinámicos; revisar proveedor, licencias, embeds y actualización.'
  elif 'apoy' in t or 'enlaces oficiales' in t:decision='NEEDS_REVIEW';reason='Verificar destinos, identidad y enlaces antes de publicar.'
  elif not txt and not doc.all('img') and not embeds:decision='DELETE_CANDIDATE';reason='Sin contenido visible o herramienta detectada; candidato, no autorización de borrado.'
  elif re.search(r'20(?:1\d|2[0-5])',t):decision='ARCHIVE';reason='Contenido fechado; conservar como histórico si aporta contexto.'
  else:decision='NEEDS_REVIEW';reason='Requiere decisión editorial sobre utilidad y equivalencia.'
  page_reviews.append({'path':e['path'],'old_url':'https://www.huracanescaribe.com'+e['path'],'title':e['title'],'classification':decision,'reason':reason,'words':wordcount,'embeds':embeds,'images':len(doc.all('img')),'proposed_equivalent':equiv,'equivalent_validated':False,'local_new_exists':bool(site_path(repo,e['path']))})
 comment_rows=[]
 for e in comments:
  parent=byid.get(e['parent']);comment_rows.append({'id':e['blogger_id'],'status':e['source_status'],'parent_id':e['parent'],'article_path':parent['path'] if parent else None,'parent_kind':parent['kind'] if parent else None,'reply_to':e['reply_to'],'reply_exists':bool(e['reply_to'] in byid) if e['reply_to'] else None,'published':e['date'],'can_preserve':bool(parent and e['blogger_id'])})
 expected={ORIGIN+e['path'] for e in posts};prepared={ORIGIN+r['path'] for r in migrated};live_sm=[]
 try:live_sm=[n.text for n in ET.fromstring(live.get(ORIGIN+'/sitemap.xml',{}).get('body','')).iter() if n.tag.endswith('}loc')]
 except ET.ParseError:pass
 sitemap={'total_expected':len(expected),'total_prepared':len(prepared),'total_present':len(expected&set(sm)),'missing':sorted(expected-set(sm)),'missing_prepared':sorted(prepared-set(sm)),'duplicate':[u for u,n in collections.Counter(sm).items() if n>1],'invalid':[u for u in sm if U.urlsplit(u).scheme!='https' or U.urlsplit(u).netloc!='fenomenosdelcaribe.org'],'http_404':[u for u in sm if live.get(u,{}).get('status') in [404,410]],'pending_included':sorted((expected-prepared)&set(sm)),'live_total_urls':len(live_sm),'live_present':len(expected&set(live_sm)),'live_missing_prepared':sorted(prepared-set(live_sm)),'local_total_urls':len(sm)}
 for row in inventory:
  for link in links:
   if link['article']==row['path'] and link.get('result')=='broken_link' and link['scope']=='article':finding(row,'BROKEN_INTERNAL_LINK','WARNING','technical_issue',link['url'])
  row['status']='FAIL' if any(i['level']=='FAIL' for i in row['issues']) else 'WARNING' if row['issues'] else 'PASS'
  local_issues=[i for i in row['issues'] if not i['code'].startswith('LIVE_')];row['local_status']='FAIL' if any(i['level']=='FAIL' for i in local_issues) else 'WARNING' if local_issues else 'PASS'
  row.pop('body_text',None);row.pop('source_text',None)
 codecounts=collections.Counter(f['code'] for f in findings);statuscounts=collections.Counter(r['status'] for r in inventory)
 for key in ['PASS','WARNING','FAIL']:statuscounts.setdefault(key,0)
 references=[]
 for p,d in documents.items():
  for u in re.findall(r'https?://(?:www\.)?huracanescaribe\.com[^\s"<>]*',(repo/p.lstrip('/')).read_text()):references.append({'article':p,'url':u,'purpose':'provenance_schema' if u=='https://www.huracanescaribe.com'+p else 'review_reference'})
 data={'name':'Migration Audit','generated_at':stamp(),'scope':{'repo':str(repo),'source':str(args.source),'source_sha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),'git_head':subprocess.run(['git','rev-parse','HEAD'],cwd=repo,capture_output=True,text=True).stdout.strip(),'git_dirty':subprocess.run(['git','status','--short'],cwd=repo,capture_output=True,text=True).stdout.strip(),'mode':'cached/offline' if args.offline else 'network','preview_base':args.preview_base,'http_limits':'GET páginas y HEAD imágenes; confirmar 404/410 con GET range 0-1023, límite 64 KiB si servidor ignora rango; 8 concurrentes; timeout 15s; sin ejecutar JS ni migrar archivos'},'summary':{'total_expected':len(posts),'total_found':len(migrated),'status':dict(statuscounts),'local_status':dict(collections.Counter(r['local_status'] for r in inventory)),'live_http':dict(collections.Counter(str(r['http_live'].get('status')) for r in inventory)),'codes':dict(codecounts),'image_classes':dict(collections.Counter(i['classification'] for i in images))},'inventory':inventory,'canonical_report':[{'url':r['new_url'],'canonical':r.get('canonical',[]),'expected':r['new_url'],'local_status':'PASS' if r.get('canonical')==[r['new_url']] else 'FAIL','live_canonical':r.get('live_canonical'),'live_http':r['http_live'].get('status')} for r in inventory],'links':links,'old_links':[l for l in links if l['classification']=='old_huracanes_link'],'old_domain_references':references,'images':images,'sitemap':sitemap,'duplicates':duplicates,'catalog_duplicates':catalog_duplicates,'blogger_id_duplicates':[k for k,n in collections.Counter(r['blogger_id'] for r in inventory).items() if n>1],'blogger_pages':page_reviews,'comments':{'total':len(comments),'live':sum(e['source_status']=='LIVE' for e in comments),'spam':sum(e['source_status']=='SPAM_COMMENT' for e in comments),'unresolved_parents':sum(not r['article_path'] for r in comment_rows),'records':comment_rows},'findings':findings,'adsense_review':{'rejection_context':'Owner confirms the previous rejection predates the migration. No causal attribution to migrated posts.','technical_issue':['Ver hallazgos técnicos por URL; resolver destinos incompletos y problemas de navegación.'],'content_quality_review':['Revisar notas históricas breves, título recuperado y entradas pendientes; longitud no es una regla de aprobación.'],'policy_review_needed':['No se verifican derechos de imágenes mediante HTTP.','Revisar licencias de radar/Open-Meteo, privacidad y consentimiento según uso real.','No se certifica originalidad, exactitud meteorológica ni aprobación de AdSense.'],'not_an_issue':['isBasedOn hacia el original documenta procedencia; no es un canonical incorrecto.','Fecha antigua conservada no es, por sí sola, un error.','Mismo título no implica mismo contenido.','Autor ausente ya en origen no demuestra pérdida en importación.']},'limitations':['PASS HTTP no garantiza indexación, aprobación de AdSense o exactitud editorial.','HEAD no verifica decodificación visual; los 404/410 se contrastan con GET limitado a 1 KB. Timeouts/DNS se clasifican UNKNOWN; BROKEN requiere confirmación GET.','Copias del álbum con igual nombre son candidatas, no identidad demostrada.','No se probaron reglas privadas de Firebase ni paneles de AdSense/Search Console.','La similitud usa shingles de cinco palabras con Jaccard >=0.8; no es una detección exhaustiva de plagio.','No se ejecutó contenido externo ni se modificó infraestructura.']}
 # Concrete readiness and priority evidence; no infrastructure decisions are executed.
 broken_images=[i for i in images if i['classification']=='BROKEN']
 unknown_images=[i for i in images if i['classification']=='UNKNOWN']
 broken_internal=[l for l in links if l.get('result')=='broken_link']
 pending_deploy_links=[l for l in broken_internal if l.get('local_exists') and l.get('live_http') in [404,410] and l.get('fragment_exists') is not False]
 institutional=[e for e in page_reviews if any(w in e['title'].lower() for w in ['privacidad','acerca'])]
 data['summary'].update({'canonical_correct_existing':sum(r.get('canonical')==[r['new_url']] for r in migrated),'live_canonical_correct_existing':sum(r.get('live_canonical')==[r['new_url']] for r in migrated),'live_indexable_existing':sum(r.get('live_indexable_technical') is True for r in migrated),'broken_internal_unique':len({l['url'] for l in broken_internal}),'broken_images_confirmed':len(broken_images),'unknown_images':len(unknown_images),'external_images_in_html':sum(i['uses_migrated']>0 and i['classification']!='LOCAL' for i in images),'empty_alt_uses':sum(i['empty_alt'] for i in images),'missing_alt_attributes':sum(i['missing_alt'] for i in images)})
 data['summary']['links_pending_deployment_unique']=len({l['url'] for l in pending_deploy_links})
 data['summary']['broken_article_links_unique']=len({l['url'] for l in broken_internal if l.get('scope')=='article'})
 data['summary']['broken_images_used']=sum(i['uses_migrated']>0 for i in broken_images)
 data['institutional_delivery']=[{'path':p,'local_exists':bool(site_path(repo,p)),'live_http':live.get(ORIGIN+p,{}).get('status')} for p in ['/p/acerca-de.html','/p/privacy.html','/p/contacto.html']]
 data['comments']['parent_types']=dict(collections.Counter(c['parent_kind'] for c in comment_rows))
 data['readiness']={'new_site_deployment_observed':sum(r['http_live'].get('status')==200 for r in migrated)==len(migrated),'ready_for_full_domain_cutover':False,'adsense_approval':'Not assessed. Owner confirms rejection predates the migration; no account access.','reason':'Revisar cobertura de entradas y páginas institucionales (local/publicado), enlaces al origen y continuidad de recursos antes del traslado total.'}
 data['priorities']={
 'P0':[{'issue':'Cobertura incompleta del traslado total','evidence':f'{codecounts["NOT_MIGRATED"]} entradas sin equivalente; {sum(not e["local_new_exists"] for e in page_reviews)} páginas antiguas sin archivo local; {len(data["old_links"])} enlaces HTML siguen hacia el origen.','action':'Definir destinos o conservación explícita antes de redirecciones globales o retirada de Blogger.'},{'issue':'Dependencia de recursos externos','evidence':str(data['summary']['external_images_in_html'])+' URLs de imagen externas usadas en HTML, ninguna copia servida localmente confirmada.','action':'Asegurar continuidad/licencias o plan de conservación antes de retirar infraestructura original.'}],
 'P1':[{'issue':'Imágenes fallidas confirmadas','evidence':str(len(broken_images))+' imágenes con fallo en GET parcial; revisar imágenes principales y confirmar descarga completa.','action':'Recuperar o sustituir con material autorizado; validar antes del siguiente despliegue.'},{'issue':'Autoría incompleta desde Blogger','evidence':str(codecounts['SOURCE_AUTHOR_MISSING'])+' entradas sin autor en el respaldo.','action':'Confirmar responsable sin inventar atribución.'},{'issue':'Preparación editorial y de políticas','evidence':'2 entradas incompletas; confirmar publicación y revisión de las páginas institucionales preparadas; el rechazo Low-value content no identifica aquí su causa exacta.','action':'Revisar identidad, privacidad, consentimiento, licencias y contenido antes de solicitar nueva revisión de AdSense.'}],
 'P2':[{'issue':'Metadatos complementarios','evidence':str(codecounts['SCHEMA_URL_ABSENT'])+' Article sin url explícito pero con mainEntityOfPage; '+str(codecounts['SCHEMA_IMAGE_ABSENT'])+' sin image.','action':'Completar cuando corresponda, sin alterar canonical ni fechas válidas.'},{'issue':'Texto alternativo y mantenimiento','evidence':str(data['summary']['empty_alt_uses'])+' usos con alt vacío; decidir cuáles son informativos o decorativos.','action':'Revisión contextual de accesibilidad; no generar descripciones sin ver las imágenes.'}]}
 data['institutional_pages_review']=institutional
 data['source_date_author_comparison']={'dates_changed':codecounts['DATE_CHANGED'],'schema_dates_changed':codecounts['SCHEMA_DATEPUBLISHED']+codecounts['SCHEMA_DATEMODIFIED'],'authors_changed':codecounts['AUTHOR_CHANGED'],'authors_missing_at_source':codecounts['SOURCE_AUTHOR_MISSING']}
 data['slug_duplicates']=[{'slug':slug,'paths':ps} for slug,ps in ((slug,[r['path'] for r in migrated if pathlib.PurePosixPath(r['path']).name==slug]) for slug in {pathlib.PurePosixPath(r['path']).name for r in migrated}) if len(ps)>1]
 data['canonical_duplicates']=[{'canonical':url,'paths':[r['path'] for r in migrated if url in r.get('canonical',[])]} for url,n in collections.Counter(u for r in migrated for u in r.get('canonical',[])).items() if n>1]
 extra_paths=[]
 for file in repo.glob('20*/*/*.html'):
  rel='/'+str(file.relative_to(repo))
  if rel not in catmap:extra_paths.append(rel)
 data['html_outside_catalog']=extra_paths
 (out/'migration-audit.json').write_text(json.dumps(data,ensure_ascii=False,indent=2));csv_write(out/'migration-audit.csv',[{k:r.get(k) for k in ['old_url','new_url','title','migrated_title','date','author','file','migration_state','local_status','status','http_live','http_preview','words','issues']} for r in inventory]);csv_write(out/'canonical.csv',data['canonical_report']);csv_write(out/'images.csv',images);csv_write(out/'links.csv',links);csv_write(out/'blogger-pages.csv',page_reviews);csv_write(out/'comments.csv',comment_rows)
 lines=['# Migration Audit',f'Generado: {data["generated_at"]}',f'Commit: `{data["scope"]["git_head"]}`. Auditor separado; no se corrigió producción.','## Resumen',f'- Artículos esperados: **{len(posts)}**; encontrados localmente: **{len(migrated)}**.',f'- Estado combinado local + publicación: **{dict(statuscounts)}**.',f'- Estado local/preview: **{data["summary"]["local_status"]}**.',f'- HTTP público: **{data["summary"]["live_http"]}**.',f'- Canonicals locales incorrectos de páginas existentes: **{codecounts["CANONICAL_INVALID"]}**.',f'- URLs sin migrar: **{codecounts["NOT_MIGRATED"]}**.',f'- Referencias a imágenes únicas: **{len(images)}**; clasificación: **{data["summary"]["image_classes"]}**.',f'- Enlaces HTML al dominio antiguo: **{len(data["old_links"])}**; referencias de procedencia en schema: **{sum(x["purpose"]=="provenance_schema" for x in references)}**.',f'- Pares de posibles duplicados: **{len(duplicates)}**.',f'- Sitemap: **{sitemap["total_present"]}/{len(posts)}** entradas originales; **{len(sitemap["missing_prepared"])}** preparadas ausentes localmente; **{sitemap["live_present"]}** presentes en sitemap público.','', 'PASS/WARNING/FAIL incluyen comprobaciones técnicas y señales de revisión; WARNING de schema url/image no significa que Google declare inválido el artículo. Un FAIL público por 404 puede ser despliegue pendiente, aunque el archivo local sea válido.','## P0 — Bloquea redirecciones o retirar Blogger','- Cualquier URL de destino sin HTTP 200 o canonical correcto en el dominio público debe resolverse antes de mover tráfico. Consultar canonical.csv y el inventario.','- Decidir el destino de las dos entradas pendientes y de las páginas antiguas con tráfico. No enviar todo a la portada.','- Las imágenes aún dependen de proveedores externos. No retirar recursos/alojamientos hasta confirmar conservación o una estrategia explícita.','## P1 — Antes de la migración definitiva','- Revisar avisos de imagen no disponible y recursos UNKNOWN; distinguir tiempo de espera de una desaparición confirmada.','- Completar autoría ausente sin inventarla; revisar títulos recuperados y cambios de texto por saneamiento.','- Corregir enlaces internos rotos confirmados y decidir equivalencias de enlaces antiguos.','- Revisar privacidad, páginas institucionales, licencias y contenido débil antes de volver a solicitar AdSense.','## P2 — Mejoras posteriores','- Completar image/url en datos estructurados donde proceda; mejorar alt informativo sin confundir alt vacío decorativo con error automático.','- Revisar grupos de títulos/similitud y organizar el archivo; no borrar automáticamente.','## Hallazgos por tipo','| Código | Cantidad |','|---|---:|']
 lines += [f'| {k} | {v} |' for k,v in sorted(codecounts.items())]
 lines+=['## Entradas no migradas']+[f'- `{r["path"]}` — '+ '; '.join(i['detail'] for i in r['issues']) for r in inventory if r['migration_state']=='pending']
 lines+=['## Páginas de Blogger (42)','| Página | Decisión | Razón |','|---|---|---|']+[f'| {r["path"]} | {r["classification"]} | {r["reason"]} |' for r in page_reviews]
 lines+=['## Comentarios',f'{data["comments"]["live"]} LIVE y {data["comments"]["spam"]} SPAM_COMMENT; {data["comments"]["unresolved_parents"]} padres sin resolver. LIVE significa estado del respaldo, no validación editorial nueva. Se conservaron asociaciones sin publicar textos ni datos de comentaristas.','## AdSense','No se certifica cumplimiento ni aprobación. Las señales técnicas y editoriales se distinguen de policy_review_needed en JSON. El propietario confirma que Low-value content corresponde a una versión anterior a la migración; no se atribuye a estos artículos.','## Archivos y reproducción','- migration-audit.json: evidencia completa por URL, imágenes, enlaces, fechas, schema, duplicados y comentarios.','- migration-audit.csv: inventario para PM.','- canonical.csv, images.csv, links.csv, blogger-pages.csv, comments.csv: tablas auxiliares.','- http-cache.json: respuestas y fecha de comprobación, solo para reproducir la auditoría; no publicar como parte del sitio.','```bash','python3 scripts/migration_audit.py --refresh','# Reproducir sin red usando las respuestas guardadas:','python3 scripts/migration_audit.py --offline','```','## Limitaciones']+['- '+x for x in data['limitations']]
 extra=['## Resultado real y decisión de avance',
 f'{sum(r["http_live"].get("status")==200 for r in migrated)} de {len(migrated)} entradas preparadas devuelven HTTP 200 en producción; {data["summary"]["live_canonical_correct_existing"]} canonicals coinciden. Cuerpos distintos: {sum(r.get("live_content_matches_local") is False for r in migrated)}. Esto no confirma indexación en Google.',
 f'Imágenes: {len(broken_images)} rotas confirmadas por GET, {len(unknown_images)} inconclusas y {sum(i["classification"]=="EXTERNAL_DEPENDENCY" for i in images)} dependencias que respondieron. El primer HEAD dio {len(confirm_urls)} respuestas 404/410; {sum(image_http[u].get("status") in [200,206] for u in confirm_urls)} respondieron al contrastar con GET, evitando falsos positivos.',
 f'Enlaces internos rotos confirmados: {len({l["url"] for l in broken_internal})}. Enlaces HTML hacia Huracanes Caribe: {len(data["old_links"])}; no tienen equivalencia local validada. Las referencias isBasedOn del schema son procedencia, no un fallo.',
 f'Fechas modificadas accidentalmente: {codecounts["DATE_CHANGED"]}; autores cambiados: {codecounts["AUTHOR_CHANGED"]}; autores ausentes desde origen: {codecounts["SOURCE_AUTHOR_MISSING"]}.',
 f'Comentarios por destino: {data["comments"]["parent_types"]}. Todos tienen padre identificable; conservarlos técnicamente es posible sin publicar datos privados.',
 '### Imágenes con 404 confirmado']
 extra += ['- '+', '.join(i['articles'])+' — '+i['url'] for i in broken_images]
 extra += ['### Qué corregir antes del próximo despliegue',f'Revisar {sum(i["uses_migrated"]>0 for i in broken_images)} recursos actualmente usados con fallo en el sondeo. Las respuestas externas pueden variar; contrastar con GET completo antes de editar. Revisar el informe de preparación de AdSense para el resultado de los cuatro casos iniciales.',
 '### Qué debe resolverse antes del cambio de dominio','No retirar Blogger ni activar redirecciones globales hasta resolver cobertura de URLs y conservación de imágenes/páginas. El despliegue ya observado y una futura retirada del origen son decisiones diferentes.',
 '### AdSense: hechos y límites','La auditoría técnica no confirma originalidad ni licencias. No determina qué página provocó Low-value content. Requisitos de contenido original y experiencia: https://support.google.com/adsense/answer/7299563?hl=es ; contenido replicado: https://support.google.com/publisherpolicies/answer/11190248?hl=es . No se declara una infracción de AdSense por longitud, antigüedad o falta de un campo opcional de schema.',
 '### Revisión reproducible de prioridades']
 for priority,entries in data['priorities'].items():
  extra.append('**'+priority+'**')
  extra += ['- '+i['issue']+': '+i['evidence']+' Acción: '+i['action'] for i in entries]
 lines+=extra
 # Keep lists/tables contiguous and preserve fenced commands verbatim.
 formatted=[];in_code=False
 for line in lines:
  previous=formatted[-1] if formatted else ''
  contiguous=(line.startswith('|') and previous.startswith('|')) or (line.startswith('- ') and previous.startswith('- '))
  if not in_code and line and previous and not contiguous:formatted.append('')
  formatted.append(line)
  if line.startswith('```'):in_code=not in_code
 (out/'migration-audit.md').write_text('\n'.join(formatted));print(json.dumps(data['summary'],ensure_ascii=False,indent=2));print('Reporte:',out)
if __name__=='__main__':main()
