import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const code=readFileSync(new URL('../js/shop.js',import.meta.url),'utf8');
function boot(overrides={}) {
  const elements=Object.fromEntries(['shop','shop-fallback','shop-fallback-message','shop-direct','shop-retry'].map(id=>[id,{dataset:{},hidden:true,childElementCount:0,setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},addEventListener(){}}]));
  const scripts=[],timers=new Map(); let observe;
  const window={fdcShopSettings:{shopName:'fenomenos-Media',shopId:1976125,prefix:'https://fenomenos-media.myspreadshop.com',enabled:true,...overrides},setTimeout(fn){timers.set(1,fn);return 1;},clearTimeout(id){timers.delete(id);}};
  runInNewContext(code,{window,document:{getElementById:id=>elements[id],createElement:()=>({}),body:{append:s=>scripts.push(s)}},MutationObserver:class{constructor(fn){observe=fn;}observe(){}disconnect(){}}});
  return {elements,scripts,window,timers,observe};
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
