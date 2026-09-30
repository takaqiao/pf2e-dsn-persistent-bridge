import test from 'node:test';
import assert from 'node:assert/strict';
import {installPf2eBridge,supportsPhysicalDialog} from '../scripts/pf2e-dialogs.js';
import {makeDie} from './fixtures/pf2e-rolls.mjs';
import {createSession} from '../scripts/session.js';

class CheckModifiersDialog {context={domains:['skill']};check={totalModifier:7};}
class DamageModifierDialog {
  constructor(type){this.context={type:'damage-roll',self:{statistic:{},
    item:{isOfType:(...types)=>types.includes(type)}}};this.formulaData={base:[]};}
}
test('unsupported blast and inline damage are rejected before grabbing',()=>{
  assert.equal(supportsPhysicalDialog(new DamageModifierDialog('weapon')),true);
  assert.equal(supportsPhysicalDialog(new DamageModifierDialog('spell')),true);
  assert.equal(supportsPhysicalDialog(new DamageModifierDialog('action')),false);
  const inline=new DamageModifierDialog('weapon');inline.context.self.statistic=null;
  assert.equal(supportsPhysicalDialog(inline),false);
});
test('radio changes update descriptors without native rerender and dispose removes listeners',()=>{
  const callbacks=new Map(),registered=new Map(),seen=[];
  const hooks={on(name,fn){callbacks.set(name,fn);return name;},off(name){callbacks.delete(name);}};
  const wrapper={register(id,path,fn){registered.set(path,fn);},unregister(id,path){registered.delete(path);}};
  class Parser {constructor(formula){this.dice=[makeDie(20,11,formula.startsWith('2')?2:1)];}}
  const root=new EventTarget();root.matches=()=>true;root.querySelector=()=>null;
  const app=new CheckModifiersDialog();app.element=[root];
  const dispose=installPf2eBridge({hooks,wrapper,game:{pf2e:{Check:{}}},
    config:{Dice:{rolls:[]},PF2E:{}},RollClass:Parser,
    onDialog:(app,data)=>seen.push(data.descriptors.length),onClose:()=>{},onFocus:()=>{},
    getSnapshot:()=>null});
  callbacks.get('renderCheckModifiersDialog')(app,[root],{});
  app.context.rollTwice='keep-higher';root.dispatchEvent(new Event('change'));
  assert.deepEqual(seen,[1,2]);
  dispose();root.dispatchEvent(new Event('change'));
  assert.deepEqual(seen,[1,2]);assert.equal(callbacks.size,0);assert.equal(registered.size,0);
});

test('closing an unsubmitted dialog releases its identity carrier',()=>{
  const callbacks=new Map(),registered=new Map();
  const hooks={on(name,fn){callbacks.set(name,fn);return name;},off(name){callbacks.delete(name);}};
  const wrapper={register(id,path,fn){registered.set(path,fn);},unregister(){}};
  class CheckRoll {}
  const root=new EventTarget();root.querySelector=()=>({querySelectorAll:()=>[]});
  const dispose=installPf2eBridge({hooks,wrapper,game:{pf2e:{Check:{}}},
    config:{Dice:{rolls:[CheckRoll]},PF2E:{damageTypes:{}}},RollClass:class {},
    onDialog:()=>createSession({id:'closed',appId:1,userId:'u',kind:'damage',mode:'public',descriptors:[]}),
    onClose:()=>{},onFocus:()=>{},getSnapshot:()=>{throw Error('Closed dialog still bound');}});
  const check=new CheckModifiersDialog();check.element=[root];
  const checkWrapper=registered.get('game.pf2e.Check.roll');
  return checkWrapper(async()=>{
    callbacks.get('renderCheckModifiersDialog')(check,[root],{});
    callbacks.get('closeCheckModifiersDialog')(check,[root]);
    const evalWrapper=registered.get('globalThis.__pf2eDsnBridge.CheckRoll.prototype.evaluate');
    return evalWrapper.call({options:{domains:check.context.domains}},async()=>{},[]);
  },{},check.context).finally(dispose);
});
