import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollBindings,evaluateWithSnapshot} from '../scripts/result-bridge.js';
import {describeDice} from '../scripts/descriptors.js';
import {createSession} from '../scripts/session.js';
import {makeDie,makeCheckRoll} from './fixtures/pf2e-rolls.mjs';
const session=id=>createSession({id,appId:id,userId:'u',kind:'check',mode:'public',descriptors:[]});
test('native CheckRoll type is the check category, not a damage flavor',async()=>{
  const preview=makeCheckRoll(),roll=makeCheckRoll();
  Object.defineProperty(roll,'type',{get:()=> 'skill-check'});
  const descriptors=describeDice(preview),snapshot={id:'native-check',mode:'public',descriptors,
    values:[{key:descriptors[0].key,value:13}]};
  await evaluateWithSnapshot(roll,snapshot,()=>roll.evaluate(),[]);
  assert.equal(roll.dice[0].results[0].result,13);
});

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
  assert.equal(roll.options.pdPhysicalComplete,false);
  assert.equal(term.roll,original);
});
test('same-face damage instances receive their own physical values',async()=>{
  const a=makeDie(6),b=makeDie(6),roll={options:{},instances:[{type:'fire',dice:[a]},
    {type:'cold',dice:[b]}]},descriptors=describeDice(roll);
  await evaluateWithSnapshot(roll,{id:'s',mode:'public',descriptors,
    values:[{key:descriptors[0].key,value:1},{key:descriptors[1].key,value:6}]},
  async()=>{a.roll();b.roll();return roll;},[]);
  assert.deepEqual([a.results[0].result,b.results[0].result],[1,6]);
  assert.equal(roll.options.pdPhysicalComplete,true);
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
  assert.equal(roll.options.pdPhysicalComplete,undefined);
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

test('confirmed physical terms carry direction while untouched terms keep native motion',async()=>{
  const a=makeDie(6),b=makeDie(8),roll={dice:[a,b],options:{}},descriptors=describeDice(roll);
  await evaluateWithSnapshot(roll,{id:'s',mode:'public',descriptors,throwDirection:{x:3,y:4},
    values:[{key:descriptors[0].key,value:6}]},async()=>{a.roll();b.roll();return roll;},[]);
  assert.deepEqual(roll.options.pdPhysicalDirection,{x:.6,y:.8});
  assert.deepEqual(a.options.pdPhysicalDirection,{x:.6,y:.8});
  assert.equal(b.options.pdPhysicalDirection,undefined);
  assert.deepEqual([a.results[0].result,b.results[0].result],[6,4]);
});

test('a partially supplied term shares direction with its native supplemental dice',async()=>{
  const term=makeDie(6,4,2),roll={dice:[term],options:{}},descriptors=describeDice(roll);
  await evaluateWithSnapshot(roll,{id:'s',mode:'public',descriptors,throwDirection:{x:0,y:1},
    values:[{key:descriptors[1].key,value:6}]},async()=>{term.roll();term.roll();return roll;},[]);
  assert.deepEqual(term.results.map(r=>r.result),[4,6]);
  assert.deepEqual(term.options.pdPhysicalDirection,{x:0,y:1});
  assert.equal(roll.options.pdPhysicalComplete,false);
});

test('private, unbound and repeated native evaluations clear copied term directions',async()=>{
  for(const snapshot of [null,{mode:'blind',values:[{key:'old',value:20}]},{mode:'public',values:[]}]) {
    const roll=makeCheckRoll({pdPhysicalDirection:{x:1,y:0}}),term=roll.dice[0];
    term.options.pdPhysicalDirection={x:1,y:0};
    await evaluateWithSnapshot(roll,snapshot,roll.evaluate.bind(roll),[]);
    assert.equal(roll.options.pdPhysicalDirection,undefined);
    assert.equal(term.options.pdPhysicalDirection,undefined);
  }
  const roll=makeCheckRoll(),descriptors=describeDice(roll);
  await evaluateWithSnapshot(roll,{id:'s',mode:'public',descriptors,throwDirection:{x:1,y:0},
    values:[{key:descriptors[0].key,value:20}]},roll.evaluate.bind(roll),[]);
  await evaluateWithSnapshot(roll,null,roll.evaluate.bind(roll),[]);
  assert.equal(roll.options.pdPhysicalDirection,undefined);
  assert.equal(roll.dice[0].options.pdPhysicalDirection,undefined);
});

test('private evaluation clears direction even from skipped persistent terms',async()=>{
  const term=makeDie(6,4,1,{pdPhysicalDirection:{x:1,y:0}}),
    roll={options:{pdPhysicalDirection:{x:1,y:0}},instances:[{type:'bleed',persistent:true,dice:[term]}]};
  await evaluateWithSnapshot(roll,null,async()=>{term.roll();return roll;},[]);
  assert.equal(term.options.pdPhysicalDirection,undefined);
});

test('failure and unused physical handoffs leave no direction marker',async()=>{
  const roll=makeCheckRoll({pdPhysicalDirection:{x:1,y:0}}),term=roll.dice[0],descriptors=describeDice(roll);
  term.options.pdPhysicalDirection={x:1,y:0};
  const snapshot={id:'s',mode:'public',descriptors,throwDirection:{x:0,y:1},
    values:[{key:descriptors[0].key,value:20}]};
  await assert.rejects(evaluateWithSnapshot(roll,snapshot,async()=>{term.roll();throw Error('native failure');},[]),/native failure/);
  assert.equal(roll.options.pdPhysicalDirection,undefined);assert.equal(term.options.pdPhysicalDirection,undefined);
  const unused=makeCheckRoll();
  await evaluateWithSnapshot(unused,snapshot,async()=>unused,[]);
  assert.equal(unused.options.pdPhysicalDirection,undefined);
  assert.equal(unused.dice[0].options.pdPhysicalDirection,undefined);
});

test('invalid snapshot direction does not enter evaluated Roll options',async()=>{
  const roll=makeCheckRoll(),descriptors=describeDice(roll);
  await evaluateWithSnapshot(roll,{id:'s',mode:'public',descriptors,throwDirection:{x:Infinity,y:0},
    values:[{key:descriptors[0].key,value:20}]},roll.evaluate.bind(roll),[]);
  assert.equal(roll.options.pdPhysicalDirection,undefined);
  assert.equal(roll.dice[0].options.pdPhysicalDirection,undefined);
});
