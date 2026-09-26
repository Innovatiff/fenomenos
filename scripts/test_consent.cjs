const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname,'../js/analytics.js'),'utf8');
function setup(hostname='fenomenosdelcaribe.org') {
  const scripts=[],buttons=[];
  const context={location:{protocol:'https:',hostname},document:{head:{appendChild:s=>scripts.push(s)},createElement:()=>({style:{},addEventListener(type,fn){this[type]=fn;}}),getElementById:()=>null,querySelector:()=>({appendChild:b=>buttons.push(b)})}};
  context.window=context;vm.createContext(context);vm.runInContext(code,context);
  return {context,scripts,buttons};
}
const env=setup();assert.equal(env.scripts.length,0);assert.equal(env.context['ga-disable-G-92SH61163V'],true);
const cmp=env.context.googlefc;
cmp.ConsentModePurposeStatusEnum={UNKNOWN:0,GRANTED:1,DENIED:2,NOT_APPLICABLE:3,NOT_CONFIGURED:4};
const ready=cmp.callbackQueue.find(x=>x.CONSENT_MODE_DATA_READY).CONSENT_MODE_DATA_READY;
let state=0;cmp.getGoogleConsentModeValues=()=>({analyticsStoragePurposeConsentStatus:state,adStoragePurposeConsentStatus:2,adUserDataPurposeConsentStatus:2,adPersonalizationPurposeConsentStatus:2});
for(state of [0,2,4]){ready();assert.equal(env.scripts.length,0);}
state=1;ready();ready();assert.equal(env.scripts.length,1);assert.equal(env.context['ga-disable-G-92SH61163V'],false);
state=2;ready();assert.equal(env.context['ga-disable-G-92SH61163V'],true);
state=3;ready();assert.equal(env.scripts.length,1);assert.equal(env.context['ga-disable-G-92SH61163V'],false);
cmp.getGoogleConsentModeValues=()=>{throw new Error('CMP unavailable');};
ready();assert.equal(env.context['ga-disable-G-92SH61163V'],true);
let revoked=0;cmp.showRevocationMessage=()=>revoked++;
cmp.callbackQueue.find(x=>x.CONSENT_API_READY).CONSENT_API_READY();assert.equal(env.buttons.length,1);
env.buttons[0].click();cmp.callbackQueue.at(-1).CONSENT_API_READY();assert.equal(revoked,1);assert.equal(env.context['ga-disable-G-92SH61163V'],true);
assert.equal(setup('localhost').scripts.length,0);
console.log('Consent checks passed: missing CMP, unknown/denied/unconfigured, granted, repeat, revocation, not-applicable and localhost.');
