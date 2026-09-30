import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldSuppressRevision} from '../scripts/dsn-adapter.js';
import {makeCheckRoll} from './fixtures/pf2e-rolls.mjs';
import {makeBridgeHarness} from './fixtures/bridge-harness.mjs';
test('ordinary reroll removes cloned physical suppression through installed wrapper',async()=>{
  const h=await makeBridgeHarness(),roll=makeCheckRoll();roll.options.pdPhysicalRevision='old';
  await h.evaluateUnboundNativeRoll(roll);assert.equal(roll.options.pdPhysicalRevision,undefined);
  assert.equal(shouldSuppressRevision(roll,'old'),false);
});
test('only the recorded current physical revision suppresses animation',()=>{
  const roll={options:{pdPhysicalRevision:'new'}};
  assert.equal(shouldSuppressRevision(roll,'new'),true);
  assert.equal(shouldSuppressRevision(roll,'old'),false);assert.equal(shouldSuppressRevision(roll),false);
});
