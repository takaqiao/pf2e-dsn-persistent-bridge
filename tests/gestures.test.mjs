import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGestureHarness} from './fixtures/gesture-harness.mjs';
const lift=h=>{h.pointerDown();h.advance(300);h.pointerMove(20,0);};
test('short press and release while armed do not spawn or throw',async()=>{
  const h=makeGestureHarness();h.pointerDown();h.advance(299);h.pointerUp();h.advance(300);await h.flush();
  assert.equal(h.adapter.spinCalls,0);assert.equal(h.adapter.releaseCalls,0);
  h.pointerDown();h.advance(300);assert.equal(h.states.at(-1),'armed');h.pointerUp();await h.flush();
  assert.equal(h.adapter.spinCalls,0);assert.equal(h.session.generation,0);
});
test('release during async lift removes late dice and never throws',async()=>{
  const h=makeGestureHarness();lift(h);h.pointerUp();h.resolveSpawn('new-die');await h.flush();
  assert.equal(h.adapter.releaseCalls,0);assert.deepEqual(h.adapter.removed,['new-die']);
});
test('stationary held release calls native throw exactly once',async()=>{
  const h=makeGestureHarness();lift(h);h.resolveAllSpawns();await h.flush();
  h.pointerUp();h.pointerUp();await h.flush();assert.equal(h.adapter.spinCalls,1);assert.equal(h.adapter.releaseCalls,1);
});
test('growth announces held once and finishes by wall time despite a delayed frame',async()=>{
  const h=makeGestureHarness();lift(h);h.resolveAllSpawns();await h.flush();
  h.advance(32);h.advance(118);
  assert.equal(h.states.filter(state=>state==='held').length,1);
  assert.equal(h.adapter.scales.at(-1),1);
});
test('moves preserve actual flick samples for native trajectory',async()=>{
  const h=makeGestureHarness();lift(h);h.resolveAllSpawns();await h.flush();h.pointerMove(-40,10);
  assert.equal(h.adapter.moves.at(-1).clientX,80);assert.equal(h.adapter.moves.at(-1).clientY,110);
});
for(const action of ['cancel','blur','escape']) test(`${action} cancels held dice without a throw`,async()=>{
  const h=makeGestureHarness();lift(h);h.resolveAllSpawns();await h.flush();h[action]();await h.flush();
  assert.equal(h.adapter.releaseCalls,0);assert.deepEqual(h.adapter.removed,['die-0']);
});
test('private mode, closed session and changed box invalidate async lifting',async()=>{
  for(const invalidate of [h=>h.session.cancel('closed'),h=>h.session.replace({mode:'blind',descriptors:h.session.descriptors}),h=>h.adapter.boxGeneration++]) {
    const h=makeGestureHarness();lift(h);invalidate(h);h.resolveAllSpawns();await h.flush();
    assert.equal(h.adapter.spinCalls,0);assert.deepEqual(h.adapter.removed,['die-0']);
  }
});
test('space repeat does not create a second batch and keyboard release throws',async()=>{
  const h=makeGestureHarness();h.keyDown();h.keyDown(true);h.advance(300);h.resolveAllSpawns();await h.flush();
  h.keyUp();await h.flush();assert.equal(h.adapter.spinCalls,1);assert.equal(h.adapter.releaseCalls,1);
});
test('nonprimary or outside presses cannot intercept native decorative dice',()=>{
  const h=makeGestureHarness();h.pointerDown({isPrimary:false});h.advance(300);assert.equal(h.states.length,0);
  h.pointerDown({clientX:250});h.advance(300);assert.equal(h.states.length,0);
});
test('failed spawn cancels the entire batch and restores the preview state',async()=>{
  const h=makeGestureHarness();lift(h);h.failSpawn();await h.flush();assert.equal(h.states.at(-1),'idle');
  assert.equal(h.adapter.spinCalls,0);assert.equal(h.adapter.releaseCalls,0);
});
