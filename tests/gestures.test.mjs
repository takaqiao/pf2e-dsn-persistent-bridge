import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGestureHarness} from './fixtures/gesture-harness.mjs';
import {deferred} from './fixtures/dsn-runtime.mjs';
import {selectThrowDirection} from '../scripts/throw-direction.js';
const lift=h=>{h.pointerDown();h.advance(300);h.pointerMove(20,0);};
function captureRelease(h) {
  let release=null,randomCalls=0;const original=h.adapter.releaseGrab.bind(h.adapter);
  h.adapter.releaseGrab=async(samples,time)=>{
    release={samples,time,direction:selectThrowDirection(samples,time,()=>{randomCalls++;return .25;})};
    return original(samples,time);
  };
  return {get release(){return release;},get randomCalls(){return randomCalls;}};
}
test('short press and release while armed do not spawn or throw',async()=>{
  const h=makeGestureHarness();h.pointerDown();h.advance(299);h.pointerUp();h.advance(300);await h.flush();
  assert.equal(h.adapter.spinCalls,0);assert.equal(h.adapter.releaseCalls,0);
  h.pointerDown();h.advance(300);assert.equal(h.states.at(-1),'armed');h.pointerUp();await h.flush();
  assert.equal(h.adapter.spinCalls,0);assert.equal(h.session.generation,0);
});

test('pointer and keyboard presses wait for the preview material to finish loading',()=>{
  const h=makeGestureHarness();h.element.dataset={state:'loading'};
  h.pointerDown();h.keyDown();h.advance(350);assert.equal(h.states.length,0);
  h.element.dataset.state='ready';h.pointerDown();h.advance(300);assert.equal(h.states.at(-1),'armed');
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

test('release carries the movement that triggered lifting after a long press',async()=>{
  const h=makeGestureHarness(),capture=captureRelease(h);
  h.pointerDown();h.advance(300);h.pointerMove(12,0);h.resolveAllSpawns();await h.flush();
  h.pointerUp();await h.flush();
  assert.deepEqual(capture.release.samples,[{clientX:100,clientY:100,time:0},
    {clientX:112,clientY:100,time:300}]);
  assert.equal(capture.release.time,300);assert.deepEqual(capture.release.direction,{x:1,y:0});
  assert.equal(capture.randomCalls,0);
});

test('movement while spawning and awaiting the grab remains in release samples',async()=>{
  const h=makeGestureHarness(),capture=captureRelease(h),grab=deferred();
  const original=h.adapter.beginGrab.bind(h.adapter);
  h.adapter.beginGrab=async(...args)=>{await original(...args);return grab.promise;};
  lift(h);h.advance(20);h.pointerMove(0,3);h.resolveAllSpawns();await h.flush();
  h.advance(20);h.pointerMove(-3,0);grab.resolve(true);await h.flush();h.pointerUp();await h.flush();
  assert.deepEqual(capture.release.samples,[{clientX:100,clientY:100,time:0},
    {clientX:120,clientY:100,time:300},{clientX:120,clientY:103,time:320},
    {clientX:117,clientY:103,time:340}]);
  assert.deepEqual(capture.release.direction,{x:-1,y:0});assert.equal(capture.randomCalls,0);
});

test('pointer release adds its final position using the gesture clock',async()=>{
  const h=makeGestureHarness(),capture=captureRelease(h);lift(h);h.resolveAllSpawns();await h.flush();
  h.advance(20);
  const event=new Event('pointerup',{cancelable:true});
  Object.assign(event,{pointerId:1,clientX:120,clientY:103});h.element.dispatchEvent(event);await h.flush();
  assert.deepEqual(capture.release.samples.at(-1),{clientX:120,clientY:103,time:320});
  assert.deepEqual(capture.release.direction,{x:0,y:1});assert.equal(capture.release.time,320);
});

test('a paused release keeps one old anchor and chooses randomness only once',async()=>{
  const h=makeGestureHarness(),capture=captureRelease(h);lift(h);h.resolveAllSpawns();await h.flush();
  h.advance(200);h.pointerUp();h.pointerUp();await h.flush();
  assert.deepEqual(capture.release.samples,[{clientX:120,clientY:100,time:300}]);
  assert.equal(capture.release.time,500);assert.ok(Math.abs(capture.release.direction.x)<1e-12);
  assert.equal(capture.release.direction.y,1);assert.equal(capture.randomCalls,1);
});

test('stationary pointer events do not append samples or refresh movement time',async()=>{
  const h=makeGestureHarness(),capture=captureRelease(h);lift(h);h.resolveAllSpawns();await h.flush();
  for(let i=0;i<300;i++) {h.advance(1);h.pointerMove(0,0);}
  h.pointerUp();await h.flush();
  assert.deepEqual(capture.release.samples,[{clientX:120,clientY:100,time:300}]);
  assert.equal(capture.release.time,600);assert.equal(capture.randomCalls,1);
});

test('a long drag retains the last 200ms and one earlier anchor',async()=>{
  const h=makeGestureHarness(),capture=captureRelease(h);lift(h);h.resolveAllSpawns();await h.flush();
  for(let i=0;i<600;i++) {h.advance(1);h.pointerMove(1,0);}
  h.pointerUp();await h.flush();
  assert.equal(capture.release.samples.length,201);
  assert.equal(capture.release.samples[0].time,700);assert.equal(capture.release.samples[1].time,701);
  assert.deepEqual(capture.release.samples.at(-1),{clientX:720,clientY:100,time:900});
  assert.deepEqual(capture.release.direction,{x:1,y:0});
});

test('keyboard release carries no pointer movement even when the mouse moved',async()=>{
  const h=makeGestureHarness(),capture=captureRelease(h);
  h.keyDown();h.advance(300);h.resolveAllSpawns();await h.flush();h.pointerMove(20,30);h.keyUp();await h.flush();
  assert.deepEqual(capture.release.samples,[{clientX:100,clientY:100,time:0}]);
  assert.equal(capture.release.time,300);assert.ok(Math.abs(capture.release.direction.x)<1e-12);
  assert.equal(capture.release.direction.y,1);assert.equal(capture.randomCalls,1);
});

test('a release without pointer coordinates still passes the recorded samples',async()=>{
  const h=makeGestureHarness(),capture=captureRelease(h);lift(h);h.resolveAllSpawns();await h.flush();
  const event=new Event('pointerup',{cancelable:true});Object.assign(event,{pointerId:1});
  h.element.dispatchEvent(event);await h.flush();
  assert.deepEqual(capture.release.samples,[{clientX:100,clientY:100,time:0},
    {clientX:120,clientY:100,time:300}]);
  assert.deepEqual(capture.release.direction,{x:1,y:0});
});
