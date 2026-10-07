const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');
for(const mode of ['fail','pending']) for(const file of ['index-articles.js','articles-page.js']) test(file+' retains initial cards when sources '+mode,async()=>{
 const seed=[{id:'archive:/2025/test.html',title:'Real article',tags:[]}];
 const children=[{real:true}];
 const elements={};
 function element(){return {dataset:{},children:[],classList:{add(){},toggle(){}},appendChild(){},append(){},after(){},before(){},addEventListener(){},setAttribute(){},querySelectorAll(){return []},replaceChildren(...nodes){this.children=nodes}};}
 const grid=element();grid.children=children;
 elements['home-articles']=grid;elements['articles-grid']=grid;elements['initial-articles']={textContent:JSON.stringify(seed)};
 const document={getElementById(id){return elements[id]??=element()},createElement:element,createTextNode:x=>x,querySelector:()=>null};
 let code=readFileSync('js/'+file,'utf8').replace(/^import .*;$/gm,'').replace(/import\("\.\/db.js"\)/g,mode === 'fail' ? 'Promise.reject(new Error("Firebase offline"))' : 'new Promise(()=>{})');
 runInNewContext(code,{document,window:{},location:{search:''},URLSearchParams,console:{warn(){},error(){}},setTimeout:()=>0,fetchArchive:()=>Promise.reject(new Error('Archive offline')),articleTagList:a=>a.tags||[],normalizeText:x=>x,newestFirst:x=>x,articleCard:()=>{throw Error('Should retain existing cards')}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(grid.children,children);
});
