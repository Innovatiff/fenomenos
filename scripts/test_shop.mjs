import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const code=readFileSync(new URL('../js/shop.js',import.meta.url),'utf8');
function boot(overrides={}, disclosure=false, hash="") {
  const elements=Object.fromEntries(['shop','shop-fallback','shop-fallback-message','shop-direct','shop-retry'].map(id=>[id,{dataset:{},hidden:true,childElementCount:0,setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},addEventListener(){}}]));
  const events={};
  if(disclosure) elements.comprar={tagName:'DETAILS',open:false,addEventListener(name,fn){events[name]=fn;}};
  const scripts=[],timers=new Map(); let observe;
  const window={location:{hash},addEventListener(){},fdcShopSettings:{shopName:'fenomenos-Media',shopId:1976125,prefix:'https://fenomenos-media.myspreadshop.com',enabled:true,...overrides},setTimeout(fn){timers.set(1,fn);return 1;},clearTimeout(id){timers.delete(id);}};
  runInNewContext(code,{window,document:{querySelectorAll:()=>[],getElementById:id=>elements[id],createElement:()=>({}),body:{append:s=>scripts.push(s)}},MutationObserver:class{constructor(fn){observe=fn;}observe(){}disconnect(){}}});
  return {elements,scripts,window,timers,observe,events};
}
test('unverified domain and disabled integration make no provider request',()=>{
  for(const config of [{prefix:'https://unverified.example'},{enabled:false}]){const s=boot(config);assert.equal(s.scripts.length,0);assert.equal(s.elements.shop.dataset.state,'unavailable');assert.equal(s.elements['shop-direct'].hidden,true);}
});
test('official embed keeps host metadata and hash navigation',()=>{
  const s=boot();assert.equal(s.scripts[0].src,'https://fenomenos-media.myspreadshop.com/js/shopclient.nocache.js');assert.equal(s.window.spread_shop_config.updateMetadata,false);assert.equal(s.window.spread_shop_config.usePushState,false);assert.equal('locale' in s.window.spread_shop_config,false);
});
test('script failure shows a usable verified fallback',()=>{
  const s=boot();s.scripts[0].onerror();assert.equal(s.elements.shop.dataset.state,'error');assert.equal(s.elements['shop-fallback'].hidden,false);assert.equal(s.elements['shop-direct'].href,'https://fenomenos-media.myspreadshop.com');assert.equal(s.timers.size,0);
});
test('slow provider retains fallback and never replaces a late storefront',()=>{
  const s=boot();s.timers.get(1)();assert.equal(s.elements['shop-fallback'].hidden,false);s.elements.shop.childElementCount=1;s.observe();assert.equal(s.elements.shop.dataset.state,undefined);assert.equal(s.timers.size,0);
});

test('collapsed shop waits for opening and never loads twice',()=>{
  const s=boot({},true);assert.equal(s.scripts.length,0);
  s.elements.comprar.open=true;s.events.toggle();assert.equal(s.scripts.length,1);
  s.elements.comprar.open=false;s.events.toggle();
  s.elements.comprar.open=true;s.events.toggle();assert.equal(s.scripts.length,1);
});
test('direct shop anchor opens the live storefront',()=>{
  const s=boot({},true,'#comprar');assert.equal(s.elements.comprar.open,true);assert.equal(s.scripts.length,1);
});
