import {MOD_ID,SETTINGS} from './constants.js';
export function registerSettings(onChange=()=>{},game=globalThis.game) {
  for(const [key,type,scope,value,range] of [
    [SETTINGS.enabled,Boolean,'world',true],
    [SETTINGS.traySize,Number,'client',220,{min:160,max:320,step:10}],
    [SETTINGS.autoSubmitOnFill,Boolean,'client',true],
    [SETTINGS.verboseLogging,Boolean,'client',false]
  ]) game.settings.register(MOD_ID,key,{name:`PD.Settings.${key}.Name`,hint:`PD.Settings.${key}.Hint`,
    type,scope,default:value,range,config:true,onChange:()=>onChange(key)});
}
export async function migrateSettings(game=globalThis.game) {
  if(game.user.getFlag(MOD_ID,'trayMigration')==='0.5.1') return;
  if(game.user.isGM&&game.settings.get('dice-so-nice','persistentDice'))
    await game.settings.set('dice-so-nice','persistentDice',false);
  await game.user.setFlag(MOD_ID,'trayMigration','0.5.1');
}
