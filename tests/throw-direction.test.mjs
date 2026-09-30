import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeThrowDirection,selectThrowDirection,applyThrowDirection} from '../scripts/throw-direction.js';

test('direction accepts finite nonzero axes and freezes a normalized copy',()=>{
  const input={x:3,y:4},direction=normalizeThrowDirection(input);
  assert.deepEqual(direction,{x:.6,y:.8});input.x=9;
  assert.equal(direction.x,.6);assert.equal(Object.isFrozen(direction),true);
  for(const invalid of [null,{},[],{x:0,y:0},{x:NaN,y:1},{x:1,y:Infinity},{x:'1',y:0}])
    assert.equal(normalizeThrowDirection(invalid),null);
});

test('one recent 3px movement after a long hold chooses its direction',()=>{
  let randomCalls=0;
  const direction=selectThrowDirection([{clientX:10,clientY:20,time:100},
    {clientX:13,clientY:20,time:1000}],1100,()=>{randomCalls++;return .25;});
  assert.deepEqual(direction,{x:1,y:0});assert.equal(randomCalls,0);
});

test('small recent movements accumulate and a final turn controls direction',()=>{
  assert.deepEqual(selectThrowDirection([{clientX:0,clientY:0,time:800},
    {clientX:1,clientY:0,time:900},{clientX:3,clientY:0,time:1000}],1050),{x:1,y:0});
  assert.deepEqual(selectThrowDirection([{clientX:0,clientY:0,time:970},
    {clientX:4,clientY:0,time:980},{clientX:4,clientY:3,time:995}],1000),{x:0,y:1});
});

test('a 200ms pause chooses one random direction despite stationary pointer events',()=>{
  let randomCalls=0;
  const direction=selectThrowDirection([{clientX:0,clientY:0,time:900},
    {clientX:4,clientY:0,time:1000},{clientX:4,clientY:0,time:1199}],1200,
  ()=>{randomCalls++;return .25;});
  assert.ok(Math.abs(direction.x)<1e-12);assert.equal(direction.y,1);
  assert.equal(randomCalls,1);assert.equal(Object.isFrozen(direction),true);
});

test('sub-threshold, missing and malformed motion falls back once',()=>{
  for(const samples of [[],[{clientX:2,clientY:3,time:100}],
    [{clientX:0,clientY:0,time:90},{clientX:2.99,clientY:0,time:100}],
    [{clientX:0,clientY:0,time:90},{clientX:NaN,clientY:0,time:100}],
    [{clientX:0,clientY:0,time:90},{clientX:20,clientY:0,time:101}]]) {
    let randomCalls=0;
    assert.deepEqual(selectThrowDirection(samples,100,()=>{randomCalls++;return 0;}),{x:1,y:0});
    assert.equal(randomCalls,1);
  }
});

test('mixed notation keeps dice order and native vectors for untagged or invalid dice',()=>{
  const dice=[{id:'right',options:{pdPhysicalDirection:{x:2,y:0}}},
    {id:'native',options:{}},{id:'down',options:{pdPhysicalDirection:{x:0,y:1}}},
    {id:'invalid',options:{pdPhysicalDirection:{x:NaN,y:0}}},
    {id:'right-again',options:{pdPhysicalDirection:{x:1,y:0}}}];
  const notation={dice,dsnConfig:{appearance:{}},messageId:'message'},processed=[];
  const original=(group,vector,boost,dist)=>{
    for(const die of group.dice) {
      processed.push(die.id);die.resolvedAppearance={name:die.id};
      die.vectors={velocity:{x:vector.x/dist*boost,y:-.0032,z:vector.y/dist*boost}};
    }
    return group;
  };
  assert.equal(applyThrowDirection(original,notation,{x:3,y:4},10,5),notation);
  assert.equal(notation.dice,dice);
  assert.deepEqual(processed,['right','native','down','invalid','right-again']);
  assert.deepEqual(dice.map(d=>[d.vectors.velocity.x,d.vectors.velocity.z]),
    [[10,0],[6,8],[0,10],[6,8],[10,0]]);
  assert.deepEqual(dice.map(d=>d.resolvedAppearance.name),['right','native','down','invalid','right-again']);
});

test('ordinary notation keeps the native object and return value',()=>{
  const notation={dice:[{options:{}}]},answer={native:true};
  const original=group=>{assert.equal(group,notation);return answer;};
  assert.equal(applyThrowDirection(original,notation,{x:3,y:4},10,5),answer);
});
