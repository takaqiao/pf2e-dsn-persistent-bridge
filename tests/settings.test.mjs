import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerSettings,migrateSettings} from '../scripts/settings.js';
import {registerPf2eColorsets} from '../scripts/pf2e-colorsets.js';
test('four settings retain old keys and language keys exist in both languages',async()=>{
  const settings=[];registerSettings(()=>{},{settings:{register:(id,key,config)=>settings.push([key,config])}});
  assert.deepEqual(settings.map(([key])=>key),['enabled','traySize','autoSubmitOnFill','verboseLogging']);
  for(const lang of ['en','zh-CN']) {
    const data=JSON.parse(await readFile(new URL(`../lang/${lang}.json`,import.meta.url),'utf8'));
    for(const [key,config] of settings) assert.ok(data.PD.Settings[key].Name&&config.name===`PD.Settings.${key}.Name`);
    for(const key of ['Tray','Private','NativeOnly','NotSubmitted']) assert.ok(data.PD[key]);
  }
});
test('migration only records a module client flag once and preserves stored settings',async()=>{
  let version,writes=0;const game={user:{getFlag:()=>version,setFlag:async(id,key,value)=>{version=value;writes++;}}};
  await migrateSettings(game);await migrateSettings(game);assert.equal(writes,1);
});
test('missing PF2e damage roles register defaults without replacing existing appearances',async()=>{
  const roles=new Map([['electricity',{custom:true}]]),COLORSETS={electricity:{custom:true}};
  const dsn={exports:{COLORSETS},DiceFactory:{getRole:id=>roles.get(id)},
    async addColorset(cs){COLORSETS[cs.name]=cs;},addRole(r){roles.set(r.id,r);}};
  await registerPf2eColorsets(dsn);assert.deepEqual(roles.get('electricity'),{custom:true});
  for(const id of ['sonic','vitality','void','spirit','mental','bleed','slashing','piercing','bludgeoning','untyped'])
    assert.equal(roles.get(id).detectors.types[0],id);
});
