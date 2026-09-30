import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollBindings,evaluateWithSnapshot} from '../scripts/result-bridge.js';
import {describeDice} from '../scripts/descriptors.js';
import {createSession} from '../scripts/session.js';
import {makeDie,makeCheckRoll} from './fixtures/pf2e-rolls.mjs';
const session=id=>createSession({id,appId:id,userId:'u',kind:'check',mode:'public',descriptors:[]});

test('identical checks sharing original domains remain separate in reverse order',()=>{
  const bindings=createRollBindings(), domains=['skill-check'];
  const a={context:{domains}},b={context:{domains}};
  const ia=bindings.beginCheck(a.context),ib=bindings.beginCheck(b.context);
  bindings.armCheck(a,session('a')); bindings.armCheck(b,session('b'));
  assert.equal(bindings.resolve({options:{domains:b.context.domains}}).id,'b');
  assert.equal(bindings.resolve({options:{domains:a.context.domains}}).id,'a');
  assert.equal(bindings.resolve({options:{domains:[...domains]}}),null);
  bindings.endCheck(ia); bindings.endCheck(ib);
  assert.equal(a.context.domains,domains); assert.equal(b.context.domains,domains);
});
test('reused active context cancels both physical paths and restores domains',()=>{
  const bindings=createRollBindings(), original=['attack'], context={domains:original};
  const a=bindings.beginCheck(context),s=session('a'); bindings.armCheck({context},s);
  const b=bindings.beginCheck(context);
  bindings.armCheck({context},session('b'));
  assert.equal(s.status,'cancelled');
  assert.equal(bindings.resolve({options:{domains:context.domains}}),null);
  bindings.endCheck(a); bindings.endCheck(b);
  assert.equal(context.domains,original);
});
test('two weapon templates with identical contents bind by base identity',()=>{
  const bindings=createRollBindings(), a={formulaData:{base:[]},context:{}},
    b={formulaData:{base:[]},context:{}};
  bindings.armWeaponDamage(a,session('a'));bindings.armWeaponDamage(b,session('b'));
  assert.equal(bindings.resolve({options:{damage:{damage:{base:b.formulaData.base}}}}).id,'b');
  assert.equal(bindings.resolve({options:{damage:{damage:{base:[]}}}}),null);
});
test('spell handoff binds exact returned Roll and not a preview or macro Roll',()=>{
  const bindings=createRollBindings(), context={}, roll=makeCheckRoll();
  bindings.armWeaponDamage({context,formulaData:{base:[]}},session('spell'));
  assert.equal(bindings.bindSpellResult({context,template:{damage:{roll}}}),true);
  assert.equal(bindings.resolve(roll).id,'spell');
  assert.equal(bindings.resolve(makeCheckRoll()),null);
  bindings.release('spell'); assert.equal(bindings.resolve(roll),null);
});
test('partial physical values retain ordinal and RNG appends only once',async()=>{
  const term=makeDie(6,4,2),roll={dice:[term],options:{}}, descriptors=describeDice(roll);
  const original=term.roll, snapshot={id:'s',kind:'damage',mode:'public',descriptors,
    values:[{key:descriptors[1].key,value:6}]};
  await evaluateWithSnapshot(roll,snapshot,async()=>{term.roll();term.roll();term.roll();return roll;},[]);
  assert.deepEqual(term.results.map(r=>r.result),[4,6,4]);
  assert.equal(term.roll,original);
});
test('same-face damage instances receive their own physical values',async()=>{
  const a=makeDie(6),b=makeDie(6),roll={options:{},instances:[{type:'fire',dice:[a]},
    {type:'cold',dice:[b]}]},descriptors=describeDice(roll);
  await evaluateWithSnapshot(roll,{id:'s',mode:'public',descriptors,
    values:[{key:descriptors[0].key,value:1},{key:descriptors[1].key,value:6}]},
  async()=>{a.roll();b.roll();return roll;},[]);
  assert.deepEqual([a.results[0].result,b.results[0].result],[1,6]);
});
test('evaluation failure restores an inherited Die.roll method',async()=>{
  const proto=makeDie(6),term=Object.assign(Object.create(proto),{results:[]}),
    roll={dice:[term],options:{}}, descriptors=describeDice(roll);
  await assert.rejects(evaluateWithSnapshot(roll,{id:'s',mode:'public',descriptors,
    values:[{key:descriptors[0].key,value:5}]},async()=>{throw Error('native failure');},[]),/native failure/);
  assert.equal(Object.hasOwn(term,'roll'),false);
});
test('private or unbound evaluation cannot reuse a cloned physical marker',async()=>{
  const roll=makeCheckRoll({pdPhysicalRevision:'old'});
  await evaluateWithSnapshot(roll,{id:'s',mode:'blind',descriptors:describeDice(roll),
    values:[{key:describeDice(roll)[0].key,value:20}]},roll.evaluate.bind(roll),[]);
  assert.equal(roll.dice[0].results[0].result,11);
  assert.equal(roll.options.pdPhysicalRevision,undefined);
});
test('descriptor mismatch rejects physical handoff rather than replacing dice with RNG',async()=>{
  const roll=makeCheckRoll(),descriptor={...describeDice(roll)[0],faces:6};
  await assert.rejects(evaluateWithSnapshot(roll,{id:'s',mode:'public',descriptors:[descriptor],
    values:[{key:descriptor.key,value:6}]},roll.evaluate.bind(roll),[]),/changed/);
  assert.deepEqual(roll.dice[0].results,[]);
});
for(const value of [1,10,100]) test(`d100 physical value ${value} is preserved`,async()=>{
  const die=makeDie(100),roll={options:{},dice:[die]},descriptors=describeDice(roll);
  await evaluateWithSnapshot(roll,{id:'s',mode:'public',descriptors,
    values:[{key:descriptors[0].key,value}]},async()=>{die.roll();return roll;},[]);
  assert.equal(die.results[0].result,value);
});
