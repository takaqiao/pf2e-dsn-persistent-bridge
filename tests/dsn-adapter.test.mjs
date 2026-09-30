import test from 'node:test';
import assert from 'node:assert/strict';
import {createDsnAdapter} from '../scripts/dsn-adapter.js';
import {createSession} from '../scripts/session.js';
import {makeDsnRuntime,deferred} from './fixtures/dsn-runtime.mjs';
const descriptor=faces=>({key:'a',termPath:'0/0',ordinal:0,faces,flavor:'fire'});
async function harness(options={},faces=20) {
  const runtime=makeDsnRuntime(options),landings=[],failures=[];
  const s=createSession({id:'s',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(faces)]});
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,
    getActor:()=>options.actor??null,onSettled:(...args)=>landings.push(args),
    onFailure:(...args)=>failures.push(args),onBoxChanged:()=>{}});
  assert.equal(await adapter.ready(),true);
  const token=s.startBatch(),primary=await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  return {runtime,adapter,s,token,primary,landings,failures};
}
test('native queue success without simulation cannot settle',async()=>{
  const h=await harness({simulate:false});
  await h.runtime.triggerOwnedThrow([h.primary],[7]);
  assert.deepEqual(h.landings,[]);assert.equal(h.failures.length,1);
});
test('confirmed native landing supplies frozen logical values and suppresses only its chat',async()=>{
  const h=await harness();await h.runtime.triggerOwnedThrow([h.primary],[19]);
  assert.deepEqual(h.landings,[[h.token,[{persistentId:h.primary.userData.persistentId,value:19}]]]);
  assert.deepEqual(h.runtime.chats,[]);assert.equal(h.runtime.lastEnqueue.roll,null);
  assert.equal(h.runtime.sfxRolls[0].total,19);
});
test('merged decorative throw retains its own chat even on an owned chat carrier',async()=>{
  const runtime=makeDsnRuntime(),other=runtime.mesh('d6',{ownerUserId:'u'});
  const messages=[];
  const h=await harness({mergeExtra:{mesh:other,roll:{total:3,async toMessage(){messages.push('decorative');}}}});
  await h.runtime.triggerOwnedThrow([h.primary],[12]);
  assert.deepEqual(messages,['decorative']);assert.equal(h.landings.length,1);
});
test('unrelated throw passes its auxiliary roll unchanged',async()=>{
  const h=await harness(),roll={total:12};
  await h.runtime.box.persistentDiceManager.onQueueThrow({heldDice:[],primaries:[],
    velocity:{},forcedByMesh:new Map(),roll});
  assert.equal(h.runtime.lastEnqueue.roll,roll);assert.deepEqual(h.landings,[]);
});
test('dropped queue and old generation do not settle',async()=>{
  const h=await harness({queueResult:false});await h.runtime.triggerOwnedThrow([h.primary],[8]);
  assert.deepEqual(h.landings,[]);
  const next=await harness();next.s.replace({mode:'blind',descriptors:next.s.descriptors});
  await next.runtime.triggerOwnedThrow([next.primary],[20]);assert.deepEqual(next.landings,[]);
});
test('spawn uses reserved guests and an invalidated late mesh is removed',async()=>{
  const waiting=deferred(),runtime=makeDsnRuntime({spawnWait:waiting});
  const s=createSession({id:'s',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(20)]});
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,
    onSettled:()=>{},onBoxChanged:()=>{}});await adapter.ready();s.startBatch();
  const spawn=adapter.spawn(s,s.descriptors[0],{x:.4,y:.3});s.cancel('close');waiting.resolve();
  assert.equal(await spawn,null);assert.equal(runtime.removed.length,1);
  assert.deepEqual(runtime.spawnCalls[0].opts.guest,{pendingId:'pd-session:s',reservedForUserId:'u'});
});
test('d100 uses linked digit meshes but submits one logical value',async()=>{
  const h=await harness({},100),meshes=h.runtime.box.persistentDiceManager.persistentDiceList;
  assert.deepEqual(meshes.map(d=>d.notation.type),['d100','d10']);
  await h.runtime.triggerOwnedThrow(meshes,[100]);
  assert.deepEqual(h.landings[0][1],[{persistentId:h.primary.userData.persistentId,value:100}]);
});
test('preview avoids the board physics cache and reflects current appearance flags',async()=>{
  const h=await harness();await h.adapter.createPreview(descriptor(6));
  assert.equal(h.runtime.previewArgs.cache.type,'bridge-tray-preview');
  assert.equal(h.runtime.previewArgs.appearance.diceColor,'#123456');
  h.runtime.flags.appearance.global.diceColor='#987654';
  await h.adapter.createPreview(descriptor(6));
  assert.equal(h.runtime.previewArgs.appearance.diceColor,'#987654');
});
test('cancel during an asynchronous grab removes late constraints without throwing',async()=>{
  const h=await harness();h.runtime.grabWait=deferred();
  const grab=h.adapter.beginGrab(h.s,[h.primary],{clientX:500,clientY:400});
  const cancel=h.adapter.cancelGrab();h.runtime.grabWait.resolve();await Promise.all([grab,cancel]);
  assert.equal(h.runtime.box.inputHandler.mouse.constraintDown,false);
  assert.deepEqual(h.runtime.box.inputHandler.mouse.heldPersistentDice,[]);
  assert.equal(h.runtime.lastEnqueue,undefined);
  const removed=h.runtime.physics.filter(([name])=>name==='removeConstraint');
  assert.ok(removed.length);assert.deepEqual(removed.at(-1)[1].ids,[h.primary.id]);
});
test('mine mode briefly reveals public foreign task dice and restores the current preference',async()=>{
  const h=await harness(),box=h.runtime.box,foreign=h.runtime.mesh('d6',{
    ownerUserId:'other',guest:{pendingId:'pd-session:foreign-task'}});
  box.persistentDiceManager.persistentDiceList.push(foreign);
  box.persistentDiceManager.persistentDiceVisibility='mine';foreign.parent.visible=false;
  await box.replayRemoteThrow([foreign],{},new Map([[foreign,3]]),[]);
  assert.equal(foreign.parent.visible,false);
  const collision=h.runtime.physics.filter(([name])=>name==='setCollisionResponse');
  assert.deepEqual(collision.map(([,args])=>args),[{ids:[foreign.id],enabled:true},{ids:[foreign.id],enabled:false}]);
});
test('mine mode keeps unrelated foreign decorative dice hidden without collision overrides',async()=>{
  const runtime=makeDsnRuntime(),box=runtime.box,foreign=runtime.mesh('d6',{ownerUserId:'other'});
  const seen=[];box.replayRemoteThrow=async meshes=>seen.push(meshes.map(d=>d.parent.visible));
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled:()=>{}});
  await adapter.ready();box.persistentDiceManager.persistentDiceList.push(foreign);
  box.persistentDiceManager.persistentDiceVisibility='mine';foreign.parent.visible=false;
  await box.replayRemoteThrow([foreign],{},new Map([[foreign,3]]),[]);
  assert.deepEqual(seen,[[false]]);assert.equal(foreign.parent.visible,false);
  assert.deepEqual(runtime.physics.filter(([name])=>name==='setCollisionResponse'),[]);
});
test('a cold remote task model finishes creation before its throw and removal',async()=>{
  const wait=deferred(),h=await harness({remoteCreateWait:wait}),native=h.runtime.persistent;
  const create=native.handleMessage({type:'persistent-create',user:'other',data:{persistentId:'remote',
    guest:{pendingId:'pd-session:other-session'}}});
  const thrown=native.handleMessage({type:'persistent-throw',user:'other',data:{persistentIds:['remote']}});
  const removed=native.handleMessage({type:'persistent-remove',user:'other',data:{persistentIds:['remote']}});
  wait.resolve();await Promise.all([create,thrown,removed]);
  assert.deepEqual(h.runtime.remoteReplays,['remote']);assert.equal(h.runtime.remoteCreated.size,0);
});

test('failed compound secondary removes primary and its ownership record',async()=>{
  const runtime=makeDsnRuntime(),original=runtime.persistent.spawn;let calls=0;
  runtime.persistent.spawn=async(...args)=>++calls===2?null:original(...args);
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,
    onSettled:()=>{},onBoxChanged:()=>{}});await adapter.ready();
  const s=createSession({id:'s',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(100)]});
  s.startBatch();assert.equal(await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5}),null);
  assert.equal(adapter.ownedCount,0);assert.equal(runtime.removed.length,1);
});
test('actor appearance overrides player defaults in both preview and physical dice',async()=>{
  const actor={getFlag:(scope,key)=>key==='appearance'?{global:{diceColor:'#aa00aa'}}:{}};
  const h=await harness({actor});await h.adapter.createPreview({...descriptor(6),actorId:'actor'});
  assert.equal(h.runtime.previewArgs.appearance.diceColor,'#aa00aa');
  await h.adapter.removeSession('s');
  h.s.replace({mode:'public',descriptors:[{...descriptor(6),actorId:'actor'}]});h.s.startBatch();
  await h.adapter.spawn(h.s,h.s.descriptors[0],{x:.5,y:.5});
  assert.equal(h.runtime.spawnCalls.at(-1).opts.appearance.diceColor,'#aa00aa');
});
test('synchronous box rebuild removes old groups and binds the ready replacement',async()=>{
  const h=await harness(),old=h.runtime.box,group={};h.adapter.mountTray(group);
  const next=makeDsnRuntime().box;h.runtime._buildDiceBox=function(){this.box=next;return 'sync-result';};
  // Install lifecycle wrappers with the initial ready call, not by replacing a patched function.
  const runtime=makeDsnRuntime();runtime._buildDiceBox=function(){this.box=next;return 'sync-result';};
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled:()=>{}});
  await adapter.ready();adapter.mountTray(group);const before=runtime.box;
  assert.equal(runtime._buildDiceBox(),'sync-result');await adapter.ready();
  assert.equal(before.scene.children.includes(group),false);assert.equal(next.scene.children.includes(group),true);
  await adapter.dispose();assert.equal(next.scene.children.includes(group),false);
});
test('an empty mounted tray never starts physics or invokes native canvas hiding',async()=>{
  const runtime=makeDsnRuntime();let hides=0,fades=0;
  runtime._fadeOutCanvas=()=>hides++;runtime.box.fadeOutEphemeral=()=>fades++;
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled:()=>{}});
  await adapter.ready();adapter.mountTray({});runtime._fadeOutCanvas(1000);
  assert.equal(hides,0);assert.equal(fades,1);assert.deepEqual(runtime.physics,[]);
  await adapter.dispose();runtime._fadeOutCanvas(1000);assert.equal(hides,1);
});
test('replacing both canvas and box transfers tray visibility protection and removes it on teardown',async()=>{
  const runtime=makeDsnRuntime(),replacement=makeDsnRuntime(),oldCanvas=runtime.canvas;
  runtime._buildDiceBox=function(){this.box=replacement.box;this.canvas=replacement.canvas;};
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled:()=>{}});
  await adapter.ready();const group={};adapter.mountTray(group);
  assert.equal(oldCanvas.classList.contains('pd-tray-mounted'),true);
  runtime._buildDiceBox();await adapter.ready();
  assert.equal(replacement.box.scene.children.includes(group),true);
  assert.equal(replacement.canvas.classList.contains('pd-tray-mounted'),true);
  assert.equal(oldCanvas.classList.contains('pd-tray-mounted'),false);
  await adapter.dispose();assert.equal(replacement.canvas.classList.contains('pd-tray-mounted'),false);
});
test('cleanup of an old generation leaves a newer batch in the same dialog intact',async()=>{
  const h=await harness();h.s.replace({mode:'public',descriptors:h.s.descriptors});h.s.startBatch();
  const next=await h.adapter.spawn(h.s,h.s.descriptors[0],{x:.5,y:.5});
  await h.adapter.removeSession(h.s.id,h.token);
  assert.equal(h.adapter.ownership(next.userData.persistentId)?.mesh,next);
  assert.equal(h.adapter.ownership(h.primary.userData.persistentId),null);
});
test('early Foundry ready before DsN exists safely waits for its own ready hook',async()=>{
  const adapter=createDsnAdapter({dice3d:undefined,onSettled:()=>{}});
  assert.equal(await adapter.ready(),false);await adapter.dispose();
});
test('native guest throw without an auxiliary Roll still hands off its landed value',async()=>{
  const h=await harness();await h.runtime.box.persistentDiceManager.onQueueThrow({heldDice:[h.primary],
    primaries:[h.primary],velocity:{},forcedByMesh:new Map([[h.primary,13]]),roll:null});
  assert.deepEqual(h.landings[0]?.[1],[{persistentId:h.primary.userData.persistentId,value:13}]);
});
test('task guest cannot claim another native interactive pending roll',async()=>{
  const runtime=makeDsnRuntime();runtime.pendingThrows.pending.set('other-card',{});
  runtime.pendingThrows.claimThrow=function(){return this.pending.size?'other-card':'fresh-guest-rng';};
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled:()=>{}});await adapter.ready();
  const s=createSession({id:'s',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(20)]});s.startBatch();
  const die=await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.equal(runtime.pendingThrows.claimThrow([die],[die],new Map()),'fresh-guest-rng');
  assert.equal(runtime.pendingThrows.pending.size,1);
  assert.equal(runtime.pendingThrows.claimThrow([runtime.mesh('d20')],[],new Map()),'other-card');
});
