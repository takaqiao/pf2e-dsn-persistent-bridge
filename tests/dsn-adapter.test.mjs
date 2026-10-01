import test from 'node:test';
import assert from 'node:assert/strict';
import {createDsnAdapter} from '../scripts/dsn-adapter.js';
import {createSession} from '../scripts/session.js';
import {makeDsnRuntime,deferred} from './fixtures/dsn-runtime.mjs';
const descriptor=faces=>({key:'a',termPath:'0/0',ordinal:0,faces,flavor:'fire'});
async function harness(options={},faces=20) {
  const runtime=makeDsnRuntime(options),landings=[],failures=[];
  const s=createSession({id:'s',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(faces)]});
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,hooks:runtime.hooks,
    getActor:()=>options.actor??null,onSettled:(...args)=>landings.push(args),
    onFailure:(...args)=>failures.push(args),onBoxChanged:()=>{}});
  assert.equal(await adapter.ready(),true);
  const token=s.startBatch(),primary=await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  return {runtime,adapter,s,token,primary,landings,failures};
}

test('local task dice work with native decoration disabled and legacy restoration is blocked',async()=>{
  const h=await harness({persistentEnabled:false});assert.ok(h.primary);
  const old=await h.runtime.persistent.spawn('d6',{}, {ownerUserId:'u'},false);
  const remote=await h.runtime.persistent.spawn('d6',{},
    {guest:{pendingId:'pd-session:remote',reservedForUserId:'other'},ownerUserId:'other'},false);
  assert.equal(old,null);assert.equal(remote,null);
  await h.adapter.dispose();assert.equal(h.runtime.box.persistentDiceEnabled,false);
});

test('task dice can be grabbed and settled with native interactivity disabled',async()=>{
  const h=await harness({allowInteractivity:false,persistentEnabled:false});assert.ok(h.primary);
  assert.equal(h.runtime.box.allowInteractivity,false);
  assert.equal(await h.runtime.persistent.spawn('d6',{}, {ownerUserId:'u'},false),null);
  assert.equal(h.runtime.pendingThrows.shouldStampInteractive({rolls:[{options:{}}]}),true);
  assert.equal(await h.adapter.beginGrab(h.s,[h.primary],{clientX:500,clientY:400}),true);
  await h.adapter.moveGrab({clientX:504,clientY:400});
  await h.adapter.releaseGrab([{clientX:500,clientY:400,time:100},{clientX:504,clientY:400,time:110}],110);
  assert.ok(h.runtime.releaseVelocity.x>0);
  await h.runtime.triggerOwnedThrow([h.primary],[17]);
  assert.deepEqual(h.landings,[[h.token,[{persistentId:h.primary.userData.persistentId,value:17}]]]);
  assert.deepEqual(h.runtime.events,[]);
  assert.equal(h.runtime.box.allowInteractivity,false);
  await h.adapter.removeSession(h.s.id);await h.adapter.dispose();
  assert.equal(h.runtime.box.persistentDiceEnabled,false);
  assert.equal(h.runtime.box.allowInteractivity,false);
  assert.equal(h.runtime.box.persistentDiceList.length,0);
});

test('already restored legacy bodies clear locally without changing saved flags or broadcasting',async()=>{
  const runtime=makeDsnRuntime(),old=await runtime.persistent.spawn('d6',{}, {ownerUserId:'u'},false);
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();assert.equal(runtime.box.persistentDiceManager.persistentDiceList.includes(old),false);
  assert.deepEqual(runtime.events,[]);assert.deepEqual(runtime.removeCalls,[]);
  await adapter.dispose();
});

test('physical evaluated messages bypass native interactive pending while ordinary messages retain it',async()=>{
  const h=await harness();
  assert.equal(h.runtime.pendingThrows.shouldStampInteractive({rolls:[{options:{pdPhysicalRevision:'r'}}]}),false);
  assert.equal(h.runtime.pendingThrows.shouldStampInteractive({rolls:[{options:{}}]}),true);
  await h.adapter.dispose();
});

test('legacy creation already in flight at startup cannot leave a late physical body',async()=>{
  const wait=deferred(),runtime=makeDsnRuntime({spawnWait:wait});
  const old=runtime.persistent.spawn('d6',{}, {ownerUserId:'u'},false);
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,hooks:runtime.hooks,onSettled(){}});
  await adapter.ready();wait.resolve();await old;await Promise.resolve();
  assert.equal(runtime.box.persistentDiceManager.persistentDiceList.length,0);
  assert.deepEqual(runtime.events,[]);await adapter.dispose();
});

test('late task events stay local after ownership cleanup',async()=>{
  const h=await harness(),id=h.primary.userData.persistentId;
  await h.adapter.removeSession('s');
  h.runtime.persistent._emitPersistentEvent('throw',{data:{persistentIds:[id],results:[{forcedResult:17}]}});
  h.runtime.persistent._emitPersistentEvent('move',{data:{positions:[{persistentId:id,x:.2,y:.4}]}});
  h.runtime.persistent._emitPersistentEvent('move',{data:{positions:[]}});
  assert.deepEqual(h.runtime.events,[]);await h.adapter.dispose();
});

test('dispose drains an asynchronous native release before uninstalling event isolation',async()=>{
  const wait=deferred(),h=await harness({releaseWait:wait});
  await h.adapter.beginGrab(h.s,[h.primary],{clientX:1,clientY:1});
  const releasing=h.adapter.releaseGrab();let disposed=false;
  await new Promise(resolve=>setImmediate(resolve));
  const disposal=h.adapter.dispose().then(()=>{disposed=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(disposed,false);
  wait.resolve();await releasing;await disposal;assert.deepEqual(h.runtime.events,[]);
  assert.equal(h.adapter.ownedCount,0);
});

test('scene cleanup cannot broadcast a late asynchronous pickup',async()=>{
  const h=await harness(),wait=deferred();h.runtime.grabWait=wait;
  const grab=h.adapter.beginGrab(h.s,[h.primary],{clientX:1,clientY:1});
  h.runtime.box.clearScene();wait.resolve();await grab;
  assert.deepEqual(h.runtime.events,[]);await h.adapter.dispose();
});
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
test('local task spawn, preparation, throw and cleanup emit no persistent socket events',async()=>{
  const h=await harness(),id=h.primary.userData.persistentId;
  assert.equal(h.runtime.spawnCalls[0].sync,false);
  for(const type of ['pickup','move','preroll','throw','release'])
    h.runtime.persistent._emitPersistentEvent(type,{data:{persistentIds:[id]}});
  assert.deepEqual(h.runtime.events,[]);
  h.runtime.persistent._emitPersistentEvent('pickup',{data:{persistentIds:['ordinary']}});
  assert.equal(h.runtime.events.length,1);
  await h.adapter.removeSession(h.s.id);
  assert.deepEqual(h.runtime.removeCalls.at(-1),[id,false]);
});
test('d100 uses linked digit meshes but submits one logical value',async()=>{
  const h=await harness({},100),meshes=h.runtime.box.persistentDiceManager.persistentDiceList;
  assert.deepEqual(meshes.map(d=>d.notation.type),['d100','d10']);
  await h.runtime.triggerOwnedThrow(meshes,[100]);
  assert.deepEqual(h.landings[0][1],[{persistentId:h.primary.userData.persistentId,value:100}]);
});
test('preview warms the next physical die material without creating a persistent body',async()=>{
  const runtime=makeDsnRuntime(),adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,
    utils:runtime.utils,onSettled(){}});await adapter.ready();
  const preview=await adapter.createPreview(descriptor(6));
  assert.equal(runtime.box.persistentDiceList.length,0);assert.equal(adapter.ownedCount,0);
  assert.deepEqual(runtime.spawnCalls,[]);assert.equal(runtime.renderCalls,0);
  const s=createSession({id:'s',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(6)]});
  s.startBatch();const physical=await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.equal(preview.material,physical.material);assert.equal(preview.geometry,physical.geometry);
  await adapter.dispose();assert.equal(preview.material.disposed,false);assert.equal(preview.geometry.disposed,false);
});

test('preview still reflects current appearance flags',async()=>{
  const h=await harness();const first=await h.adapter.createPreview(descriptor(6));
  assert.equal(h.runtime.previewArgs.appearance.diceColor,'#123456');
  h.runtime.flags.appearance.global.diceColor='#987654';
  const next=await h.adapter.createPreview(descriptor(6));
  assert.equal(h.runtime.previewArgs.appearance.diceColor,'#987654');
  assert.notEqual(next.material,first.material);
});

test('preview prepares shaders for the native composer target while detached from the board',async()=>{
  for(const readBuffer of [null,{texture:{colorSpace:'linear'}}]) {
    const runtime=makeDsnRuntime(),compiled=[],previousTarget={texture:{colorSpace:'srgb'}};
    let target=previousTarget,face=3,mip=2;
    runtime.box.diceScene={finalComposer:readBuffer?{readBuffer}:null};
    Object.assign(runtime.box.renderer,{
      getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
      setRenderTarget(next,nextFace=0,nextMip=0){target=next;face=nextFace;mip=nextMip;},
      compileAsync(mesh,camera,scene){compiled.push({mesh,camera,scene,target});return Promise.resolve();}
    });
    const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
    await adapter.ready();const preview=await adapter.createPreview(descriptor(100));
    assert.deepEqual(compiled.map(c=>c.mesh.notation.type),['d100','d10']);
    assert.equal(compiled[0].mesh,preview);
    assert.ok(compiled.every(c=>c.scene===runtime.box.scene&&c.camera===runtime.box.camera));
    assert.ok(compiled.every(c=>c.target===(readBuffer??previousTarget)));
    assert.equal(target,previousTarget);assert.equal(face,3);assert.equal(mip,2);
    assert.equal(runtime.box.scene.children.length,0);assert.equal(runtime.renderCalls,0);
    assert.equal(runtime.box.persistentDiceList.length,0);
  }
});

test('pending shader preparation restores the native render target before awaiting',async()=>{
  const runtime=makeDsnRuntime(),waiting=deferred(),previousTarget={},readBuffer={};
  let target=previousTarget,compiledTarget=null;
  runtime.box.diceScene={finalComposer:{readBuffer}};
  Object.assign(runtime.box.renderer,{
    getRenderTarget:()=>target,setRenderTarget(next){target=next;},
    compileAsync(){compiledTarget=target;return waiting.promise;}
  });
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();const preview=adapter.createPreview(descriptor(6));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(compiledTarget,readBuffer);
  assert.equal(target,previousTarget);
  await adapter.dispose();waiting.resolve();
  assert.equal(await preview,null);
});

test('compound preview warms the secondary physical digit material',async()=>{
  const runtime=makeDsnRuntime(),adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,
    utils:runtime.utils,onSettled(){}});await adapter.ready();
  const requests=[],create=runtime.box.throwEngine.createDiceMesh;
  runtime.box.throwEngine.createDiceMesh=async(...args)=>{
    const result=await create(...args);requests.push(result.dicemesh);return result;
  };
  const preview=await adapter.createPreview(descriptor(100));
  assert.equal(preview.notation.type,'d100');assert.equal(runtime.box.persistentDiceList.length,0);
  const s=createSession({id:'s',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(100)]});
  s.startBatch();await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  const digits=runtime.box.persistentDiceList;
  assert.deepEqual(requests.map(d=>d.notation.type),['d100','d10']);
  assert.equal(requests[0].material,digits[0].material);assert.equal(requests[1].material,digits[1].material);
  await adapter.dispose();assert.ok(requests.every(d=>!d.material.disposed&&!d.geometry.disposed));
});

function firePalette(runtime) {
  const texture={name:'lava',id:'fire',composite:'multiply',texture:{image:{}}};
  Object.assign(runtime.flags.appearance.global,{colorset:'fire',system:'standard',
    systemSettings:{glow:true},background:['#ffeea4','#ffdc9c','#fac8b8','#910200','#814841'],foreground:'#ede2b2',
    outline:'black',edge:'#333333',texture,material:'plastic',font:'Arial',fontScale:{d4:1}});
  return texture;
}

test('a physical die reuses its preview palette choice and borrowed texture resources',async()=>{
  const runtime=makeDsnRuntime();firePalette(runtime);
  const s=createSession({id:'palette',appId:1,userId:'u',kind:'damage',mode:'public',descriptors:[descriptor(4)]});
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();const preview=await adapter.createPreview(s.descriptors[0]);
  const chosen=preview.material.userData.materialData;
  s.startBatch();const physical=await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.equal(physical.material,preview.material);
  const appearance=runtime.spawnCalls.at(-1).opts.appearance;
  assert.equal(appearance.background,chosen.background);assert.equal(appearance.texture,chosen.texture);
  assert.equal(appearance.colorset,'fire');assert.equal(appearance.system,'standard');
  assert.deepEqual(appearance.systemSettings,{glow:true});
  assert.deepEqual(runtime.flags.appearance.global.background,['#ffeea4','#ffdc9c','#fac8b8','#910200','#814841']);
  await adapter.dispose();assert.equal(preview.material.disposed,false);
});

test('a selected texture without an id retains its loaded resources on physical spawn',async()=>{
  const runtime=makeDsnRuntime();firePalette(runtime);
  const create=runtime.box.throwEngine.createDiceMesh;
  runtime.box.throwEngine.createDiceMesh=async(...args)=>{
    const result=await create(...args);delete result.dicemesh.material.userData.materialData.texture.id;return result;
  };
  const s=createSession({id:'palette',appId:1,userId:'u',kind:'damage',mode:'public',descriptors:[descriptor(4)]});
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();const preview=await adapter.createPreview(s.descriptors[0]);
  const chosen=preview.material.userData.materialData.texture;
  s.startBatch();const physical=await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.equal(physical.material,preview.material);
  assert.equal(runtime.spawnCalls.at(-1).opts.appearance.texture.texture,chosen.texture);
  assert.ok(runtime.spawnCalls.at(-1).opts.appearance.texture.id);assert.equal(chosen.id,undefined);
  await adapter.dispose();
});

test('a themed none texture keeps native theme selection available',async()=>{
  const runtime=makeDsnRuntime();firePalette(runtime);
  Object.assign(runtime.flags.appearance.global,{colorset:'random',texture:{name:'none',id:'random'}});
  const s=createSession({id:'palette',appId:1,userId:'u',kind:'damage',mode:'public',descriptors:[descriptor(4)]});
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();await adapter.createPreview(s.descriptors[0]);s.startBatch();
  await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.ok(Array.isArray(runtime.spawnCalls.at(-1).opts.appearance.background));await adapter.dispose();
});

test('per-face texture arrays keep their native appearance path',async()=>{
  const runtime=makeDsnRuntime();firePalette(runtime);
  const create=runtime.box.throwEngine.createDiceMesh;
  runtime.box.throwEngine.createDiceMesh=async(...args)=>{
    const result=await create(...args),data=result.dicemesh.material.userData.materialData;
    data.texture=[data.texture,data.texture];return result;
  };
  const s=createSession({id:'palette',appId:1,userId:'u',kind:'damage',mode:'public',descriptors:[descriptor(4)]});
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();await adapter.createPreview(s.descriptors[0]);s.startBatch();
  await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.ok(Array.isArray(runtime.spawnCalls.at(-1).opts.appearance.background));await adapter.dispose();
});

test('changed player, actor and role flags resolve a fresh physical palette',async()=>{
  for(const change of ['player','actor','role']) {
    const runtime=makeDsnRuntime();firePalette(runtime);
    const actorFlags={},actor={getFlag:(scope,key)=>actorFlags[key]};
    const s=createSession({id:'palette',appId:1,userId:'u',kind:'damage',mode:'public',
      descriptors:[{...descriptor(4),actorId:'actor'}]});
    const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,
      getActor:()=>actor,onSettled(){}});await adapter.ready();
    const preview=await adapter.createPreview(s.descriptors[0]);
    if(change==='player') runtime.flags.appearance.global.outline='white';
    else if(change==='actor') actorFlags.appearance={global:{outline:'white'}};
    else actorFlags.roleAppearance={damage:{global:{outline:'white'}}};
    s.startBatch();const physical=await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
    assert.ok(Array.isArray(runtime.spawnCalls.at(-1).opts.appearance.background),change);
    assert.notEqual(physical.material,preview.material);await adapter.dispose();
  }
});

test('a new descriptor does not inherit another preview palette choice',async()=>{
  const runtime=makeDsnRuntime();firePalette(runtime);
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();await adapter.createPreview(descriptor(4));
  const s=createSession({id:'palette',appId:1,userId:'u',kind:'damage',mode:'public',descriptors:[descriptor(4)]});
  s.startBatch();await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.ok(Array.isArray(runtime.spawnCalls.at(-1).opts.appearance.background));await adapter.dispose();
});

test('compound previews retain each physical digit palette choice',async()=>{
  const runtime=makeDsnRuntime();firePalette(runtime);
  const s=createSession({id:'palette',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(100)]});
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  const previews=[],create=runtime.box.throwEngine.createDiceMesh;
  runtime.box.throwEngine.createDiceMesh=async(...args)=>{
    const created=await create(...args);previews.push(created.dicemesh);return created;
  };
  await adapter.ready();await adapter.createPreview(s.descriptors[0]);s.startBatch();
  await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.deepEqual(previews.map(d=>d.notation.type),['d100','d10']);
  assert.equal(runtime.box.persistentDiceList[0].material,previews[0].material);
  assert.equal(runtime.box.persistentDiceList[1].material,previews[1].material);await adapter.dispose();
});

test('GLB materials without native material data preserve the fresh appearance',async()=>{
  const runtime=makeDsnRuntime();firePalette(runtime);
  runtime.flags.appearance.global.system='custom-model';
  const s=createSession({id:'model',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(4)]});
  const create=runtime.box.throwEngine.createDiceMesh;
  runtime.box.throwEngine.createDiceMesh=async(...args)=>{
    const result=await create(...args);result.dicemesh.material=[{userData:{}}];return result;
  };
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();await adapter.createPreview(s.descriptors[0]);s.startBatch();
  await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.equal(runtime.spawnCalls.at(-1).opts.appearance.system,'custom-model');
  assert.ok(Array.isArray(runtime.spawnCalls.at(-1).opts.appearance.background));await adapter.dispose();
});

test('a preview invalidated during shader preparation cannot cache an old box palette',async()=>{
  const runtime=makeDsnRuntime();firePalette(runtime);
  const s=createSession({id:'palette',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(4)]});
  const wait=deferred();runtime.box.renderer.compileAsync=()=>wait.promise;
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();const late=adapter.createPreview(s.descriptors[0]);
  await new Promise(resolve=>setImmediate(resolve));runtime.box=makeDsnRuntime().box;
  await adapter.ready();wait.resolve();assert.equal(await late,null);s.startBatch();
  await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.ok(Array.isArray(runtime.spawnCalls.at(-1).opts.appearance.background));await adapter.dispose();
});

test('a superseded preview finishing last cannot replace the displayed palette choice',async()=>{
  const runtime=makeDsnRuntime();firePalette(runtime);
  const waits=[deferred(),deferred()],compiled=[];
  runtime.box.renderer.compileAsync=mesh=>{
    const wait=waits[compiled.length];compiled.push(mesh);return wait.promise;
  };
  const s=createSession({id:'palette',appId:1,userId:'u',kind:'damage',mode:'public',descriptors:[descriptor(4)]});
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();const first=adapter.createPreview(s.descriptors[0]);
  await new Promise(resolve=>setImmediate(resolve));const latest=adapter.createPreview(s.descriptors[0]);
  await new Promise(resolve=>setImmediate(resolve));waits[1].resolve();const displayed=await latest;
  waits[0].resolve();const old=await first;assert.notEqual(old.material,displayed.material);
  s.startBatch();const physical=await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  assert.equal(physical.material,displayed.material);await adapter.dispose();
});

test('a later request for another descriptor does not supersede its palette preparation',async()=>{
  const runtime=makeDsnRuntime();firePalette(runtime);
  const waits=[deferred(),deferred()],compiled=[];
  runtime.box.renderer.compileAsync=mesh=>{
    const wait=waits[compiled.length];compiled.push(mesh);return wait.promise;
  };
  const s=createSession({id:'palette',appId:1,userId:'u',kind:'damage',mode:'public',
    descriptors:[descriptor(4),{...descriptor(4),key:'b',ordinal:1}]});
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  await adapter.ready();const first=adapter.createPreview(s.descriptors[0]);
  await new Promise(resolve=>setImmediate(resolve));const second=adapter.createPreview(s.descriptors[1]);
  await new Promise(resolve=>setImmediate(resolve));waits[1].resolve();const previewB=await second;
  waits[0].resolve();const previewA=await first;s.startBatch();
  const physicalA=await adapter.spawn(s,s.descriptors[0],{x:.4,y:.5});
  const physicalB=await adapter.spawn(s,s.descriptors[1],{x:.6,y:.5});
  assert.equal(physicalA.material,previewA.material);assert.equal(physicalB.material,previewB.material);
  await adapter.dispose();
});

test('missing native persistent cache support leaves the adapter unavailable',async()=>{
  const runtime=makeDsnRuntime();delete runtime.box.persistentDiceManager._getPersistentTextureCache;
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});
  assert.equal(await adapter.ready(),false);
});

test('a preview that finishes after teardown cannot return its borrowed mesh',async()=>{
  const runtime=makeDsnRuntime(),adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,
    utils:runtime.utils,onSettled(){}});await adapter.ready();runtime.previewWait=deferred();
  const preview=adapter.createPreview(descriptor(6));await adapter.dispose();
  runtime.previewWait.resolve();assert.equal(await preview,null);
  assert.equal(runtime.box.persistentDiceList.length,0);
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
test('held scale updates use the active native ticker instead of extra scene renders',async()=>{
  const h=await harness();h.primary.scale={clone:()=>({}),copy(){return this;},multiplyScalar(){return this;}};
  await h.adapter.beginGrab(h.s,[h.primary],{clientX:500,clientY:400});
  const before=h.runtime.renderCalls;h.adapter.setGrabScale(.5);h.adapter.setGrabScale(1);
  assert.equal(h.runtime.renderCalls,before);
});

test('held task dice clear angular momentum and skip pre-roll spinning while release remains a throw',async()=>{
  const h=await harness();await h.adapter.beginGrab(h.s,[h.primary],{clientX:500,clientY:400});
  const reset=h.runtime.physics.find(([name])=>name==='setBodyPositions');assert.ok(reset);
  assert.deepEqual(reset[1],{updates:[{id:h.primary.id,position:h.primary.parent.position}]});
  assert.equal(h.runtime.box.inputHandler.mouse.preRoll,true);assert.equal(h.primary.userData.preRollRates,null);
  h.runtime.box.inputHandler._activatePreRoll();assert.equal(h.primary.userData.preRollRates,null);
  await h.adapter.releaseGrab([{clientX:500,clientY:400,time:100},{clientX:504,clientY:400,time:110}],110);
  assert.ok(h.runtime.releaseVelocity);assert.ok(h.runtime.releaseVelocity.x>0);assert.equal(h.runtime.releaseVelocity.z,0);
  assert.ok(h.runtime.releaseVelocity.y>0);assert.equal(h.s.status,'flying');
  h.s.settle(h.token,[{persistentId:h.primary.userData.persistentId,value:10}]);
  assert.deepEqual(h.s.prepareSubmit().throwDirection,{x:1,y:0});
});

test('native pre-roll and velocity remain unchanged for unrelated dice',async()=>{
  const h=await harness(),ordinary=h.runtime.mesh('d6');
  h.runtime.box.inputHandler.mouse.heldPersistentDice=[ordinary];
  h.runtime.box.inputHandler._activatePreRoll();assert.deepEqual(ordinary.userData.preRollRates,{x:1,y:1,z:1});
  assert.deepEqual(h.runtime.box.inputHandler._computeThrowVelocity(true),{x:1,y:1,z:1});
});

test('native document mouseup cannot choose a direction before the tray releases its samples',async()=>{
  const h=await harness();await h.adapter.beginGrab(h.s,[h.primary],{clientX:500,clientY:400});
  await h.runtime.box.onMouseUp({type:'pointerup'});
  assert.equal(h.s.status,'grabbing');assert.equal(h.runtime.box.inputHandler.mouse.heldPersistentDice.length,1);
  assert.equal(h.runtime.releaseVelocity,undefined);
  await h.adapter.releaseGrab([{clientX:500,clientY:400,time:0},{clientX:504,clientY:400,time:1000}],1000);
  assert.deepEqual(h.runtime.releaseVelocity,{x:.384,y:.74656,z:0});
});

test('a second native mouseup cannot bypass pending collision restoration',async()=>{
  const h=await harness(),wait=deferred(),worker=h.runtime.box.physicsWorker,exec=worker.exec;
  worker.exec=async(name,args)=>{if(name==='setCollisionResponse'&&args.enabled) await wait.promise;return exec(name,args);};
  await h.adapter.beginGrab(h.s,[h.primary],{clientX:500,clientY:400});
  const releasing=h.adapter.releaseGrab();await new Promise(resolve=>setImmediate(resolve));
  await h.runtime.box.onMouseUp({type:'mouseup'});assert.equal(h.runtime.releaseVelocity,undefined);
  assert.equal(h.runtime.box.inputHandler.mouse.heldPersistentDice.length,1);
  wait.resolve();await releasing;assert.ok(h.runtime.releaseVelocity);
});

test('an ordinary grab can release while a previous task throw waits for its effects',async()=>{
  const wait=deferred(),h=await harness({releaseWait:wait});
  await h.adapter.beginGrab(h.s,[h.primary],{clientX:500,clientY:400});
  const releasing=h.adapter.releaseGrab();await new Promise(resolve=>setImmediate(resolve));
  const mouse=h.runtime.box.inputHandler.mouse;mouse.heldPersistentDice=[h.runtime.mesh('d6')];mouse.constraintDown=true;
  const ordinary=h.runtime.box.onMouseUp({type:'mouseup'});
  assert.equal(mouse.constraintDown,false);assert.deepEqual(mouse.heldPersistentDice,[]);
  assert.deepEqual(h.runtime.lastComputedVelocity,{x:1,y:1,z:1});
  wait.resolve();await Promise.all([releasing,ordinary]);
});

test('held bodies cannot collide into new spin and restore collision before a native throw',async()=>{
  const h=await harness();let collision=true;
  const worker=h.runtime.box.physicsWorker,exec=worker.exec;
  worker.exec=async(name,args)=>{if(name==='setCollisionResponse') collision=args.enabled;return exec(name,args);};
  const throwing=h.runtime.box.persistentDiceManager.throwPersistentDice;
  h.runtime.box.persistentDiceManager.throwPersistentDice=async(...args)=>{assert.equal(collision,true);return throwing(...args);};
  await h.adapter.beginGrab(h.s,[h.primary],{clientX:500,clientY:400});assert.equal(collision,false);
  await h.adapter.releaseGrab();assert.equal(collision,true);
  assert.deepEqual(h.runtime.physics.filter(([name])=>name==='setCollisionResponse').map(([,args])=>args),[
    {ids:[h.primary.id],enabled:false},{ids:[h.primary.id],enabled:true}]);
});

test('cancel and failed grabs restore their temporary collision state',async()=>{
  for(const fail of [false,true]) {
    const h=await harness();if(fail) h.runtime.box.inputHandler._beginPersistentGrab=async()=>{throw Error('grab failed');};
    const grabbing=h.adapter.beginGrab(h.s,[h.primary],{clientX:500,clientY:400});
    if(fail) await assert.rejects(grabbing,/grab failed/);else {await grabbing;await h.adapter.cancelGrab();}
    assert.deepEqual(h.runtime.physics.filter(([name])=>name==='setCollisionResponse').map(([,args])=>args.enabled),[false,true]);
  }
});

test('native ghost restoration after throw completion excludes current held dice',async()=>{
  const h=await harness();await h.adapter.beginGrab(h.s,[h.primary],{clientX:500,clientY:400});
  const before=h.runtime.physics.length;await h.runtime.box.throwEngine.handlePersistentThrowCompletion();
  await h.runtime.box.physicsWorker.exec('setCollisionResponse',{ids:[h.primary.id,999],enabled:true});
  assert.deepEqual(h.runtime.physics.slice(before).filter(([name])=>name==='setCollisionResponse'),[
    ['setCollisionResponse',{ids:[999],enabled:true}]]);
});

test('cancel waits for an in-flight native move before resetting constraints and pre-roll',async()=>{
  const runtime=makeDsnRuntime(),wait=deferred();
  runtime.box.onMouseMove=async()=>{await wait.promise;runtime.box.inputHandler._activatePreRoll();};
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled(){}});await adapter.ready();
  const s=createSession({id:'s',appId:1,userId:'u',kind:'check',mode:'public',descriptors:[descriptor(20)]});
  s.startBatch();const d=await adapter.spawn(s,s.descriptors[0],{x:.5,y:.5});
  await adapter.beginGrab(s,[d],{clientX:500,clientY:400});
  const moving=adapter.moveGrab({clientX:505,clientY:400});let cancelled=false;
  const cancelling=adapter.cancelGrab().then(()=>cancelled=true);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancelled,false);wait.resolve();await Promise.all([moving,cancelling]);
  assert.equal(runtime.box.inputHandler.mouse.preRoll,false);assert.deepEqual(runtime.box.inputHandler.mouse.heldPersistentDice,[]);
});

test('native chat animation takes its direction from tagged dice while untagged dice retain native vectors',async()=>{
  const h=await harness(),notation={dice:[{options:{pdPhysicalDirection:{x:0,y:1}}},{options:{}}]},vector={x:20,y:-30};
  assert.equal(h.runtime.box.throwEngine.getVectors(notation,vector,2,100),notation);
  assert.deepEqual(h.runtime.vectorCalls.map(c=>c.vector),[{x:0,y:100},vector]);
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
test('native remote handlers remain untouched because task dice are never replicated',async()=>{
  const runtime=makeDsnRuntime(),handle=runtime.persistent.handleMessage,replay=runtime.box.replayRemoteThrow;
  const adapter=createDsnAdapter({dice3d:runtime,user:runtime.user,utils:runtime.utils,onSettled:()=>{}});
  await adapter.ready();assert.equal(runtime.persistent.handleMessage,handle);
  assert.equal(runtime.box.replayRemoteThrow,replay);
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
