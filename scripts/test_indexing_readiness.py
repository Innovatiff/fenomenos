import unittest
from indexing_readiness import inspect,parse_headers,relevant_xrobots
from migration_audit import robots
URL='https://fenomenosdelcaribe.org/2025/02/example.html'
class ReadinessTests(unittest.TestCase):
 def response(self,meta='',content='<div class="post__text">Contenido histórico conservado.</div>'):
  return {'http':200,'body':f'<html><head><title>Artículo</title><link rel="canonical" href="{URL}">{meta}</head><body><h1>Artículo</h1>{content}</body></html>','headers':{},'error':'','content_type':'text/html','chain':[],'final_url':URL,'checked_at':'test','sha256':''}
 def check(self,r,rule='User-agent: *\nAllow: /',included=True):return inspect(URL,r,included,robots(rule),200)
 def test_indexable(self):self.assertEqual(self.check(self.response())['status'],'INDEXABLE')
 def test_noindex_meta_and_header(self):
  self.assertEqual(self.check(self.response('<meta name="googlebot" content="noindex">'))['status'],'BLOCKED')
  r=self.response();r['headers']={'x-robots-tag':['googlebot: none']};self.assertEqual(self.check(r)['status'],'BLOCKED')
 def test_xrobots_scopes(self):
  self.assertEqual(relevant_xrobots(['bingbot: noindex, nofollow']),[])
  self.assertEqual(relevant_xrobots(['googlebot: noindex, nofollow']),['noindex','nofollow'])
 def test_missing_sitemap_warning_not_block(self):self.assertEqual(self.check(self.response(),included=False)['status'],'WARNING')
 def test_robots_and_empty_content(self):
  self.assertEqual(self.check(self.response(),'User-agent: *\nDisallow: /')['status'],'BLOCKED')
  self.assertEqual(self.check(self.response(content=''))['status'],'BLOCKED')
 def test_redirect_evidence_and_canonical(self):
  chain=parse_headers('HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 302\r\nLocation: /next\r\n\r\nHTTP/2 200\r\nX-Robots-Tag: noindex\r\nX-Robots-Tag: nofollow\r\n\r\n')
  self.assertEqual([x['status'] for x in chain],[302,200]);self.assertEqual(chain[-1]['headers']['x-robots-tag'],['noindex','nofollow'])
  r=self.response(f'<link rel="canonical" href="https://other.example/">');self.assertEqual(self.check(r)['status'],'BLOCKED')
if __name__=='__main__':unittest.main()
