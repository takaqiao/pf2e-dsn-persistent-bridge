import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBridgeHarness} from './fixtures/bridge-harness.mjs';
test('changing public throw to private invalidates its late result',async()=>{
  const h=await makeBridgeHarness(),token=h.openPublicCheck().startBatch();
  h.setMessageMode('blind');await h.deliverLanding(token,19);assert.equal(h.submitCount,0);
  h.nativeSubmit();await h.flush();assert.equal(h.nativePrivatePath,true);
});
test('confirmed full landing requests exactly one native submit and survives UI close',async()=>{
  const h=await makeBridgeHarness(),s=h.openPublicCheck(),token=s.startBatch();
  await h.deliverLanding(token,19);await h.deliverLanding(token,19);await h.flush();
  assert.equal(h.submitCount,1);assert.equal(h.lastRoll.dice[0].results[0].result,19);
  assert.equal(h.bridge.diagnose().sessionCount,0);
});
test('native submit while grabbing or flying cancels unfinished physical values',async()=>{
  for(const flying of [false,true]) {
    const h=await makeBridgeHarness(),s=h.openPublicCheck(),token=s.startBatch();if(flying) s.setFlight(token);
    h.nativeSubmit();await h.deliverLanding(token,20);await h.flush();
    assert.equal(h.submitCount,1);assert.equal(h.lastRoll.dice[0].results[0].result,11);
    assert.equal(h.lastRoll.options.pdPhysicalRevision,undefined);
  }
});
test('disable cancels sessions and releases view, observers and owned instances',async()=>{
  const h=await makeBridgeHarness();const s=h.openPublicCheck();s.startBatch();h.adapter.ownedCount=1;
  await h.bridge.disable();assert.equal(s.status,'cancelled');assert.equal(h.adapter.disposed,true);
  assert.equal(h.view.disposed,true);assert.equal(h.bridge.diagnose().sessionCount,0);
});
test('native partial submit consumes landed slots and fills the rest with native RNG',async()=>{
  const h=await makeBridgeHarness(),s=h.openPublicCheck(2),token=s.startBatch();
  await h.deliverLanding(token,18);assert.equal(h.submitCount,0);
  h.nativeSubmit();await h.flush();assert.deepEqual(h.lastRoll.dice[0].results.map(r=>r.result),[18,11]);
});
test('manual submit keeps confirmed values after removing landed task dice',async()=>{
  const h=await makeBridgeHarness({autoSubmit:false}),s=h.openPublicCheck(),token=s.startBatch();
  h.adapter.ownedCount=1;
  await h.deliverLanding(token,18);
  assert.equal(h.adapter.ownedCount,0);assert.equal(h.submitCount,0);
  assert.equal(s.complete,true);
  h.nativeSubmit();await h.flush();
  assert.equal(h.lastRoll.dice[0].results[0].result,18);
});
test('Public as Character accepts the same physical path as Public as User',async()=>{
  const h=await makeBridgeHarness(),s=h.openPublicCheck();h.setMessageMode('ic');
  const token=s.startBatch();assert.ok(token);await h.deliverLanding(token,16);await h.flush();
  assert.equal(h.lastRoll.dice[0].results[0].result,16);
});
