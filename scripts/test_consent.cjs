const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname,'../js/analytics.js'),'utf8');
const ids = ['G-92SH61163V', 'G-XNMZEKJHQ9'];
function setup(hostname='fenomenosdelcaribe.org') {
  const scripts=[],buttons=[],updates=[];
  const context={location:{protocol:'https:',hostname},document:{head:{appendChild:s=>scripts.push(s)},createElement:()=>({style:{},addEventListener(type,fn){this[type]=fn;}}),getElementById:()=>null,querySelector:()=>({appendChild:b=>buttons.push(b)})}};
  context.window=context;
  context.gtag=(...args)=>updates.push({args,disabled:ids.map(id=>context[`ga-disable-${id}`])});
  vm.createContext(context);vm.runInContext(code,context);
  return {context,scripts,buttons,updates};
}
function assertEnabled(env, enabled) {
  for (const id of ids) assert.equal(env.context[`ga-disable-${id}`],!enabled,id);
  const last=env.updates.at(-1);
  if(last?.args[0]==='consent') assert.deepEqual(last.disabled,[!enabled,!enabled],'Both gates must be set before consent update');
}
const env=setup();assert.equal(env.scripts.length,0);assertEnabled(env,false);
const cmp=env.context.googlefc;
// Exact enum names observed in the production CMP, not shortened test aliases.
cmp.ConsentModePurposeStatusEnum={
  CONSENT_MODE_PURPOSE_STATUS_UNKNOWN:0,
  CONSENT_MODE_PURPOSE_STATUS_GRANTED:1,
  CONSENT_MODE_PURPOSE_STATUS_DENIED:2,
  CONSENT_MODE_PURPOSE_STATUS_NOT_APPLICABLE:3,
  CONSENT_MODE_PURPOSE_STATUS_NOT_CONFIGURED:4
};
const ready=cmp.callbackQueue.find(x=>x.CONSENT_MODE_DATA_READY).CONSENT_MODE_DATA_READY;
let state=0;
const values=()=>({analyticsStoragePurposeConsentStatus:state,adStoragePurposeConsentStatus:2,adUserDataPurposeConsentStatus:2,adPersonalizationPurposeConsentStatus:2});
cmp.getGoogleConsentModeValues=values;
for(state of [undefined,null,"1",0,2,4]){ready();assert.equal(env.scripts.length,0);assertEnabled(env,false);}
state=1;ready();ready();assert.equal(env.scripts.length,1);assertEnabled(env,true);
assert.equal(env.scripts[0].src,'https://www.googletagmanager.com/gtag/js?id=G-92SH61163V');
assert.equal(env.updates.filter(x=>x.args[0]==='config').length,1,'No extra tag/config for connected destination');
state=2;ready();assertEnabled(env,false);
assert.equal(env.updates.at(-1).args[2].analytics_storage,'denied');
// Reproduce the user's production result: every purpose explicitly granted.
cmp.getGoogleConsentModeValues=()=>({analyticsStoragePurposeConsentStatus:1,adStoragePurposeConsentStatus:1,adUserDataPurposeConsentStatus:1,adPersonalizationPurposeConsentStatus:1});
ready();assertEnabled(env,true);
assert.deepEqual({...env.updates.at(-1).args[2]}, {analytics_storage:'granted',ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted'});
cmp.getGoogleConsentModeValues=values;
state=3;ready();assert.equal(env.scripts.length,1);assertEnabled(env,true);
cmp.getGoogleConsentModeValues=()=>{throw new Error('CMP unavailable');};
ready();assertEnabled(env,false);
cmp.getGoogleConsentModeValues=values;state=1;ready();assertEnabled(env,true);
cmp.getGoogleConsentModeValues=()=>null;ready();assertEnabled(env,false);
cmp.getGoogleConsentModeValues=values;ready();assertEnabled(env,true);
let revoked=0;cmp.showRevocationMessage=()=>revoked++;
cmp.callbackQueue.find(x=>x.CONSENT_API_READY).CONSENT_API_READY();assert.equal(env.buttons.length,1);
env.buttons[0].click();assertEnabled(env,false);
cmp.callbackQueue.at(-1).CONSENT_API_READY();assert.equal(revoked,1);
state=1;ready();assertEnabled(env,true);assert.equal(env.scripts.length,1);
vm.runInContext(code,env.context);assert.equal(env.scripts.length,1);
assert.equal(setup('localhost').scripts.length,0);
console.log('PASS: both GA4 IDs gated for initial/unknown/denied/unconfigured consent, grant, revocation, re-grant, CMP errors; one tag/config only.');
