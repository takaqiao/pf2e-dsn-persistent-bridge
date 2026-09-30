import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldSuppressRevision} from '../scripts/dsn-adapter.js';
import {makeCheckRoll} from './fixtures/pf2e-rolls.mjs';
import {makeBridgeHarness} from './fixtures/bridge-harness.mjs';
import {installMessageSuppression} from '../scripts/main.js';
test('only a locally displayed physical revision suppresses its author animation',()=>{
  const handlers=new Map(),hooks={on(name,fn){handlers.set(name,fn);return name;},off(name){handlers.delete(name);}};
  const roll={options:{pdPhysicalRevision:'physical',pdPhysicalComplete:true},dice:[{}]},message={id:'m',author:{id:'u'},rolls:[roll]};
  const game={user:{id:'u'},messages:new Map([['m',message]])};
  const suppression=installMessageSuppression(hooks,game),pre=handlers.get('diceSoNiceMessagePreProcess');
  const remote={willTrigger3DRoll:true};pre('m',remote);assert.equal(remote.willTrigger3DRoll,true);
  suppression.remember(roll);
  const local={willTrigger3DRoll:true};pre('m',local);assert.equal(local.willTrigger3DRoll,false);
  message.rolls.push({options:{},dice:[{}]});
  const mixed={willTrigger3DRoll:true};pre('m',mixed);assert.equal(mixed.willTrigger3DRoll,true);
  message.rolls=[{options:{pdPhysicalRevision:'partial',pdPhysicalComplete:false},dice:[{}]}];
  suppression.remember(message.rolls[0]);
  const partial={willTrigger3DRoll:true};pre('m',partial);assert.equal(partial.willTrigger3DRoll,true);
  message.rolls=[roll];
  game.user.id='other';const receiver={willTrigger3DRoll:true};pre('m',receiver);assert.equal(receiver.willTrigger3DRoll,true);
  suppression();assert.equal(handlers.size,0);
});
test('ordinary reroll removes cloned physical suppression through installed wrapper',async()=>{
  const h=await makeBridgeHarness(),roll=makeCheckRoll();roll.options.pdPhysicalRevision='old';
  await h.evaluateUnboundNativeRoll(roll);assert.equal(roll.options.pdPhysicalRevision,undefined);
  assert.equal(shouldSuppressRevision(roll,'old'),false);
});

test('enabled visible inline RNG results retain native animation alongside a complete physical roll',()=>{
  const handlers=new Map(),hooks={on(name,fn){handlers.set(name,fn);return name;},off(){}};
  const roll={options:{pdPhysicalRevision:'physical',pdPhysicalComplete:true},dice:[{}]},message={author:{id:'u'},rolls:[roll],
    content:'<a class="inline-roll inline-result" data-roll="rng">1d6 = 4</a>'};
  let enabled=true;const game={user:{id:'u'},messages:new Map([['m',message]]),settings:{get:()=>enabled}};
  const document={createElement(){return {set innerHTML(value){this.content=value;},querySelector(){
    return this.content.includes('inline-result')&&!this.content.includes('inline-dsn-hidden')?{}:null;}};}};
  const suppression=installMessageSuppression(hooks,game,document);suppression.remember(roll);
  const pre=handlers.get('diceSoNiceMessagePreProcess');let interception={willTrigger3DRoll:true};
  pre('m',interception);assert.equal(interception.willTrigger3DRoll,true);
  enabled=false;interception={willTrigger3DRoll:true};pre('m',interception);assert.equal(interception.willTrigger3DRoll,false);
  enabled=true;message.content='<a class="inline-roll inline-result inline-dsn-hidden">hidden</a>';
  interception={willTrigger3DRoll:true};pre('m',interception);assert.equal(interception.willTrigger3DRoll,false);suppression();
});
test('only the recorded current physical revision suppresses animation',()=>{
  const roll={options:{pdPhysicalRevision:'new'}};
  assert.equal(shouldSuppressRevision(roll,'new'),true);
  assert.equal(shouldSuppressRevision(roll,'old'),false);assert.equal(shouldSuppressRevision(roll),false);
});
