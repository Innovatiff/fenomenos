#!/usr/bin/env python3
"""Read-only checks for the prepared site; complements Migration Audit."""
import json,re,urllib.parse as U
from pathlib import Path
from migration_audit import Doc,Node,site_path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parents[1]/'outputs/adsense-readiness'
ORIGIN='https://fenomenosdelcaribe.org'
def visible_nodes(node,hidden=False):
    hidden=hidden or 'hidden' in node.attrs or 'hidden' in node.attrs.get('class','').split() or node.tag in {'script','style','template'}
    if not hidden:yield node
    for c in node.children:
        if isinstance(c,Node):yield from visible_nodes(c,hidden)
def audit():
    rewrites={}
    for line in (ROOT/'_redirects').read_text().splitlines():
        fields=line.split()
        if len(fields)==3 and fields[2]=='200' and '*' not in fields[0]:rewrites[fields[0]]=fields[1]
    broken=[];empty=[];placeholders=[];ads=[];institutions=[];deferred=[]
    for file in sorted(ROOT.rglob('*.html')):
        if any(p.startswith('.') for p in file.relative_to(ROOT).parts):continue
        path='/'+str(file.relative_to(ROOT));doc=Doc(file.read_text());visible=list(visible_nodes(doc.root))
        for a in (n for n in visible if n.tag=='a'):
            href=a.attrs.get('href','')
            if not href or href=='#':empty.append({'page':path,'label':a.text()});continue
            url=U.urljoin(ORIGIN+path,href);parts=U.urlsplit(url)
            if parts.netloc!='fenomenosdelcaribe.org':continue
            target=site_path(ROOT,rewrites.get(parts.path,parts.path))
            if not target:broken.append({'page':path,'href':href,'kind':'missing_target'})
            elif parts.fragment and target.suffix=='.html' and not any(n.attrs.get('id')==U.unquote(parts.fragment) or n.attrs.get('name')==U.unquote(parts.fragment) for n in Doc(target.read_text()).all()):broken.append({'page':path,'href':href,'kind':'missing_fragment'})
            if parts.path=='/proximamente.html':deferred.append({'page':path,'href':href})
        main=next(iter(doc.all('main')),doc.root)
        for match in re.findall(r'(?i)TUENLACE|TULINK|lorem ipsum',main.text()):placeholders.append({'page':path,'match':match})
        sources=[n.attrs.get('src','') for n in doc.all('script') if 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js' in n.attrs.get('src','')]
        if sources:ads.append({'page':path,'count':len(sources),'correct_publisher':all(U.parse_qs(U.urlsplit(u).query).get('client')==['ca-pub-5012752012707398'] for u in sources)})
    for path in ['/p/acerca-de.html','/p/privacy.html','/p/contacto.html']:
        file=site_path(ROOT,path);doc=Doc(file.read_text()) if file else None
        institutions.append({'path':path,'exists':bool(file),'canonical_correct':bool(doc and doc.canon()==[ORIGIN+path]),'h1_count':len(doc.all('h1')) if doc else 0})
    result={'broken_visible_local_links':broken,'empty_visible_links':empty,'visible_links_to_unfinished_page':deferred,'literal_placeholders':placeholders,'ad_tags':ads,'institutions':institutions,'ads_txt_correct':(ROOT/'ads.txt').read_text().strip()=='google.com, pub-5012752012707398, DIRECT, f08c47fec0942fa0','limitations':['Static HTML inspection, not a Firebase database or consent-platform audit.','Netlify explicit 200 rewrites resolved; wildcard proxy availability requires live HTTP.','A placeholder attribute on a form field is not unfinished content.']}
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'site-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps({k:v for k,v in result.items() if k not in ['ad_tags','limitations']},ensure_ascii=False,indent=2))
    assert not broken and not empty and not placeholders,'Inspect site-check.json'
    assert all(a['count']==1 and a['correct_publisher'] for a in ads)
    assert result['ads_txt_correct'] and all(i['exists'] and i['canonical_correct'] and i['h1_count']==1 for i in institutions)
if __name__=='__main__':audit()
