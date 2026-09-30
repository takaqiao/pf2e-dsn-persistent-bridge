import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('DsN ready event starts the bridge while native box initialization is pending',async()=>{
  const source=await readFile(new URL('../scripts/main.js',import.meta.url),'utf8');
  const events=new Map();let enabled=0;
  const game={version:'14.368',system:{id:'pf2e',version:'8.5.1'},
    modules:new Map([['lib-wrapper',{active:true}],['dice-so-nice',{active:true,version:'6.4.1'}],
      ['pf2e-dsn-persistent-bridge',{}]])};
  const hooks={once:(n,f)=>events.set(n,f),on:(n,f)=>events.set(n,f)};
  const prior=globalThis.Hooks;globalThis.Hooks=hooks;
  try {
    new Function('Hooks','game','foundry','readSetting','SETTINGS','MOD_ID','registerSettings',
      'registerPf2eColorsets','createBridge','installMessageSuppression','migrateSettings','runChecks','warn',
      source.slice(source.indexOf('if(globalThis.Hooks)')))(hooks,game,{utils:{isNewerVersion:()=>false}},
        ()=>true,{enabled:'enabled'},'pf2e-dsn-persistent-bridge',()=>{},async()=>{},
        ()=>({enable:async()=>{enabled++;},diagnose:()=>({capabilities:{enabled:true}})}),
        ()=>()=>{},async()=>{},()=>{},e=>{throw e;});
    events.get('ready')();await new Promise(r=>setImmediate(r));assert.equal(enabled,0);
    game.dice3d={box:{ready:null}};
    events.get('diceSoNiceReady')();await new Promise(r=>setImmediate(r));assert.equal(enabled,0);
    game.dice3d.box.ready=Promise.resolve();
    events.get('diceSoNiceReady')();await new Promise(r=>setImmediate(r));
    assert.equal(enabled,1);
  } finally {globalThis.Hooks=prior;}
});
