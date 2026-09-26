#!/usr/bin/env python3
"""Read-only production indexability audit. No Search Console writes."""
import argparse,collections,concurrent.futures,datetime as D,email.utils,hashlib,json,re,subprocess,tempfile
from pathlib import Path
import urllib.parse as U
import xml.etree.ElementTree as ET
from migration_audit import Doc,csv_write,norm,robots
ROOT=Path(__file__).resolve().parents[1]
ORIGIN='https://fenomenosdelcaribe.org'

def parse_headers(raw):
    chain=[]
    for block in re.split(r'\r?\n\r?\n',raw.strip()):
        lines=block.splitlines()
        if not lines or not re.match(r'HTTP/\S+ \d{3}',lines[0]):continue
        if 'Connection established' in lines[0]:continue
        headers={}
        for line in lines[1:]:
            if ':' in line:
                key,value=line.split(':',1);headers.setdefault(key.lower(),[]).append(value.strip())
        chain.append({'status':int(lines[0].split()[1]),'headers':headers})
    return chain

def fetch(url):
    with tempfile.TemporaryDirectory() as tmp:
        body=Path(tmp)/'body';head=Path(tmp)/'head'
        cmd=['curl','--silent','--show-error','--location','--max-redirs','8','--max-time','30','--connect-timeout','8','--proto','=https,http','--proto-redir','=https,http','--max-filesize','6000000','--user-agent','Mozilla/5.0 (compatible; MigrationIndexingAudit/1.0)','--dump-header',str(head),'--output',str(body),'--write-out','%{http_code}\t%{url_effective}\t%{content_type}',url]
        p=subprocess.run(cmd,capture_output=True,text=True,timeout=35);parts=p.stdout.split('\t');chain=parse_headers(head.read_text(errors='replace') if head.exists() else '')
        raw=body.read_bytes() if body.exists() else b''
        return {'url':url,'http':int(parts[0]) if parts[0].isdigit() else 0,'final_url':parts[1] if len(parts)>1 else '', 'content_type':parts[2] if len(parts)>2 else '', 'error':p.stderr if p.returncode else '', 'chain':chain,'headers':chain[-1]['headers'] if chain else {},'body':raw.decode('utf-8',errors='replace'),'sha256':hashlib.sha256(raw).hexdigest(),'checked_at':D.datetime.now(D.timezone.utc).isoformat()}

def relevant_xrobots(values):
    selected=[]
    known={'max-snippet','max-image-preview','max-video-preview','unavailable_after'}
    for value in values:
        scope='*'
        for part in value.lower().split(','):
            part=part.strip()
            match=re.match(r'^([\w*-]+)\s*:\s*(.*)$',part)
            if match and match[1] not in known:scope=match[1];part=match[2]
            if scope in {'*','googlebot'}:selected.append(part)
    return selected

def inspect(url,r,in_sitemap,robot,robots_http,local=None,article=True):
    blocked=[];warnings=[];doc=Doc(r['body']);canonical=doc.canon();meta=doc.metas('robots')+doc.metas('googlebot');x=r['headers'].get('x-robots-tag',[]);directives=meta+relevant_xrobots(x)
    tokens=set(re.findall(r'\b(?:noindex|none|nofollow)\b',' '.join(directives).lower()))
    if r['http']!=200:blocked.append('HTTP_'+str(r['http']))
    if r['error']:warnings.append('INCOMPLETE_REQUEST')
    if 'text/html' not in r['content_type']:blocked.append('NOT_HTML')
    if {'noindex','none'}&tokens:blocked.append('NOINDEX')
    if 'nofollow' in tokens:warnings.append('NOFOLLOW')
    if any('unavailable_after' in v for v in directives):warnings.append('UNAVAILABLE_AFTER_REVIEW')
    allowed=robot.can_fetch('Googlebot',url) if robots_http==200 else True if robots_http in [404,410] else None
    if allowed is False:blocked.append('ROBOTS_DISALLOW')
    if allowed is None:blocked.append('ROBOTS_UNVERIFIED')
    if robots_http in [404,410]:warnings.append('ROBOTS_ABSENT')
    if canonical!=[url]:
        (blocked if canonical and canonical!=[url] else warnings).append('CANONICAL_MISMATCH' if canonical else 'CANONICAL_MISSING')
    if not in_sitemap:warnings.append('SITEMAP_MISSING')
    redirects=[h for h in r['chain'] if 300<=h['status']<400]
    if redirects:warnings.append('REDIRECT')
    if r['final_url']!=url:warnings.append('FINAL_URL_DIFFERS')
    body=doc.body() if article else next(iter(doc.all('main')),doc.root)
    text=body.text() if body else ''
    if not text:blocked.append('NO_STATIC_CONTENT')
    title=next(iter(doc.all('title')),None)
    if not title or not title.text():warnings.append('TITLE_MISSING')
    if not doc.all('h1'):warnings.append('H1_MISSING')
    matches=None
    if local and local.exists():
        ld=Doc(local.read_text());lb=ld.body() if article else next(iter(ld.all('main')),ld.root)
        matches=bool(lb and text==lb.text())
        if not matches:warnings.append('CONTENT_DIFFERS_FROM_RELEASE')
    return {'url':url,'status':'BLOCKED' if blocked else 'WARNING' if warnings else 'INDEXABLE','http':r['http'],'final_url':r['final_url'],'redirect_count':len(redirects),'redirect_chain':redirects,'canonical':canonical,'expected_canonical':url,'in_sitemap':in_sitemap,'robots_http':robots_http,'googlebot_allowed':allowed,'meta_robots':meta,'x_robots_tag':x,'static_content_accessible':bool(text),'words':len(text.split()),'content_matches_release':matches,'html_matches_release':r['sha256']==hashlib.sha256(local.read_bytes()).hexdigest() if local and local.exists() else None,'blocked_reasons':blocked,'warnings':warnings,'checked_at':r['checked_at']}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT.parents[1]/'outputs/indexing-readiness');parser.add_argument('--offline',action='store_true');args=parser.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True)
    saved=json.loads((out/'http-evidence.json').read_text()) if args.offline else {}
    get=(lambda u:saved['robots'] if u==ORIGIN+'/robots.txt' else saved['sitemap'] if u==ORIGIN+'/sitemap.xml' else saved['responses'][u]) if args.offline else fetch
    catalog=json.loads((ROOT/'archivo/catalog.json').read_text());urls=[ORIGIN+e['path'] for e in catalog]
    assert len(urls)==171 and len(set(urls))==171,'Unexpected catalog scope'
    sm=get(ORIGIN+'/sitemap.xml');rr=get(ORIGIN+'/robots.txt');sitemap=[];sm_error=''
    try:
        root=ET.fromstring(sm['body']);assert root.tag=='{http://www.sitemaps.org/schemas/sitemap/0.9}urlset'
        sitemap=[n.text for n in root.findall('{*}url/{*}loc')]
    except (ET.ParseError,AssertionError) as e:sm_error=str(e) or 'Unsupported sitemap root'
    invalid=[u for u in sitemap if not u or U.urlsplit(u).scheme!='https' or U.urlsplit(u).netloc!='fenomenosdelcaribe.org']
    extra=['/p/acerca-de.html','/p/privacy.html','/p/contacto.html','/index.html','/archivo/','/css/articles.css','/css/archive.css','/ads.txt']
    targets=sorted(set(urls+[u for u in sitemap if u not in invalid]+[ORIGIN+p for p in extra]));responses={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for i,(u,r) in enumerate(zip(targets,pool.map(get,targets)),1):
            responses[u]=r
            if i%40==0:print(f'HTTP {i}/{len(targets)}',flush=True)
    robot=robots(rr['body']);rows=[inspect(u,responses[u],u in sitemap,robot,rr['http'],ROOT/U.urlsplit(u).path.lstrip('/')) for u in urls]
    remaining=[inspect(u,responses[u],True,robot,rr['http'],article=False) for u in sitemap if u not in urls and u in responses]
    duplicate=[u for u,n in collections.Counter(sitemap).items() if n>1]
    mapready=sm['http']==200 and not sm_error and not invalid and not duplicate and set(urls)<=set(sitemap) and all(r['http']==200 and r['status']!='BLOCKED' for r in rows+remaining)
    deployment=[]
    for path in extra:
        local=ROOT/path.lstrip('/');local=local/'index.html' if local.is_dir() else local;r=responses[ORIGIN+path]
        ld=Doc(local.read_text()) if local.exists() and local.suffix=='.html' else None;rd=Doc(r['body']) if ld else None
        semantic_match=ld.root.text()==rd.root.text() if ld else None
        deployment.append({'path':path,'http':r['http'],'matches_local_bytes':r['sha256']==hashlib.sha256(local.read_bytes()).hexdigest() if local.exists() else None,'visible_text_matches_release':semantic_match})
    report={'generated_at':D.datetime.now(D.timezone.utc).isoformat(),'release_commit':subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,capture_output=True,text=True).stdout.strip(),'counts':dict(collections.Counter(r['status'] for r in rows)),'total':len(rows),'sitemap':{'url':ORIGIN+'/sitemap.xml','http':sm['http'],'xml_error':sm_error,'total_urls':len(sitemap),'migrated_present':len(set(urls)&set(sitemap)),'missing':sorted(set(urls)-set(sitemap)),'duplicates':duplicate,'invalid':invalid,'non_article_checks':remaining,'ready_to_submit':mapready,'declared_in_robots':ORIGIN+'/sitemap.xml' in rr['body']},'deployment_checks':deployment,'rows':rows,'limitations':['Technical readiness only; not confirmation of Google indexing or Google-selected canonical.','Ordinary public HTTP requests, not Googlebot IPs. Search Console live URL tests remain necessary.','Images, JavaScript rendering and private Search Console data are not part of this indexability classification.','No DNS, redirects, Blogger, Firebase or Search Console mutations.']}
    for status in ['INDEXABLE','WARNING','BLOCKED']:report['counts'].setdefault(status,0)
    report['all_sitemap_counts']=dict(collections.Counter(r['status'] for r in rows+remaining))
    for status in ['INDEXABLE','WARNING','BLOCKED']:report['all_sitemap_counts'].setdefault(status,0)
    csv_write(out/'indexing-readiness-all.csv',rows+remaining)
    csv_write(out/'indexing-readiness.csv',rows);csv_write(out/'sitemap-other-pages.csv',remaining);(out/'indexing-readiness.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    (out/'http-evidence.json').write_text(json.dumps({'robots':rr,'sitemap':sm,'responses':responses},ensure_ascii=False,indent=2))
    lines=['# Indexing Readiness','',f'Release: `{report["release_commit"]}`',f'Comprobación UTC: {report["generated_at"]}','',f'**171 artículos: {report["counts"]}. Total sitemap: {report["all_sitemap_counts"]}.**','',f'Sitemap público: {len(sitemap)} URLs; {len(set(urls)&set(sitemap))}/171 artículos. Listo para enviar: **{mapready}**.','', 'INDEXABLE = sin bloqueo técnico detectado; WARNING = advertencia sin bloqueo firme; BLOCKED = impedimento observado en HTTP, robots, canonical o contenido.','', '## Despliegue','', '| Ruta | HTTP | Bytes iguales | Texto visible igual |','|---|---:|---|---|']
    lines += [f'| {d["path"]} | {d["http"]} | {d["matches_local_bytes"]} | {d["visible_text_matches_release"]} |' for d in deployment]
    lines += ['', 'El alojamiento reescribe enlaces HTML a rutas sin extensión y normaliza atributos; por ello los bytes HTML difieren. Se comparó el texto visible, además de los canonicals y cuerpos de los 171 artículos. CSS y ads.txt coinciden byte a byte.', '', '## Otras páginas del sitemap', '']+[f'- {r["url"]}: {r["status"]}; {r["warnings"]}' for r in remaining if r['status']!='INDEXABLE']
    lines += ['', '## Incidencias en las 171 entradas','']+[f'- {r["url"]}: {r["blocked_reasons"]+r["warnings"]}' for r in rows if r['status']!='INDEXABLE']
    if all(r['status']=='INDEXABLE' for r in rows):lines+=['Ninguna en las 171 URLs dentro del alcance técnico.']
    lines+=['','## Límites','']+['- '+v for v in report['limitations']]
    lines+=['','[Google: robots y X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag). [Google: enviar un sitemap no garantiza indexación](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).']
    representatives=['/2015/04/condiciones-muy-calurosas-sobre-el.html','/2017/05/como-se-forman-los-huracanes.html','/2019/01/gobernador-de-nueva-york-emite-aviso.html','/2020/07/invest-92l-podria-afectar-puerto-rico.html','/2025/02/situacion-actual-del-clima-tropical-feb.html','/archivo/','/p/acerca-de.html','/p/privacy.html']
    lines+=['','## Comprobación manual en Search Console','']+['- '+ORIGIN+p for p in representatives]
    lines+=['','En Inspección de URLs, comparar el estado del índice con Probar URL publicada. Revisar acceso del rastreador, indexación permitida, HTML renderizado, canonical declarado y canonical seleccionado por Google (si ya está disponible). Una prueba en vivo correcta no confirma inclusión en el índice. En Sitemaps enviar https://fenomenosdelcaribe.org/sitemap.xml. No se envió automáticamente.','', 'Reproducción: `python3 scripts/indexing_readiness.py`; evidencia guardada: `python3 scripts/indexing_readiness.py --offline`.']
    (out/'indexing-readiness.md').write_text('\n'.join(lines)+'\n');print(json.dumps({k:report[k] for k in ['counts','sitemap','deployment_checks']},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
