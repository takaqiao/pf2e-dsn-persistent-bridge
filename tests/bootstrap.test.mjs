import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
for(const {name,pf2e='8.6.0',foundry='14.368',dsn='6.4.1',system='pf2e',capable=true,want=1} of [
  {name:'allows PF2e before 8.5.1',pf2e:'8.4.0'},
  {name:'allows PF2e 8.5.1',pf2e:'8.5.1'},
  {name:'allows PF2e 8.6.0'},
  {name:'uses contracts for older Foundry labels',foundry:'14.360'},
  {name:'uses contracts for older DsN labels',dsn:'6.4.0'},
  {name:'uses contracts for future labels',foundry:'15.1',dsn:'7.0.0'},
  {name:'requires native PF2e entry points',capable:false,want:0},
  {name:'requires the PF2e system',system:'dnd5e',want:0}
]) test(`bridge startup ${name} after the native DsN box becomes available`,async()=>{
  const source=await readFile(new URL('../scripts/main.js',import.meta.url),'utf8');
  const events=new Map();let enabled=0;
  const game={version:foundry,system:{id:system,version:pf2e},
    modules:new Map([['lib-wrapper',{active:true}],['dice-so-nice',{active:true,version:dsn}],
      ['pf2e-dsn-persistent-bridge',{}]])};
  const hooks={once:(n,f)=>events.set(n,f),on:(n,f)=>events.set(n,f)};
  const prior=globalThis.Hooks;globalThis.Hooks=hooks;
  try {
    new Function('Hooks','game','foundry','readSetting','SETTINGS','MOD_ID','registerSettings',
      'registerPf2eColorsets','createBridge','installMessageSuppression','migrateSettings','runChecks','warn','canInstallPf2eBridge',
      source.slice(source.indexOf('if(globalThis.Hooks)')))(hooks,game,{utils:{
        isNewerVersion:(a,b)=>a.localeCompare(b,'en',{numeric:true})>0}},
        ()=>true,{enabled:'enabled'},'pf2e-dsn-persistent-bridge',()=>{},async()=>{},
        ()=>({enable:async()=>{enabled++;},diagnose:()=>({capabilities:{enabled:true}})}),
        ()=>()=>{},async()=>{},()=>{},e=>{throw e;},()=>capable);
    events.get('ready')();await new Promise(r=>setImmediate(r));assert.equal(enabled,0);
    game.dice3d={box:{ready:null}};
    events.get('diceSoNiceReady')();await new Promise(r=>setImmediate(r));assert.equal(enabled,0);
    game.dice3d.box.ready=Promise.resolve();
    events.get('diceSoNiceReady')();await new Promise(r=>setImmediate(r));
    assert.equal(enabled,want);
  } finally {globalThis.Hooks=prior;}
});
