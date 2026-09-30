const COMPOUND={100:[['d100',10],['d10',1]],
  1000:[['d1000',100],['d100',10],['d10',1]],
  10000:[['d10000',1000],['d1000',100],['d100',10],['d10',1]]};
const TASK_PREFIX='pd-session:';
export function shouldSuppressRevision(roll,recordedRevision) {
  return typeof recordedRevision==='string'&&recordedRevision.length>0&&
    roll.options?.pdPhysicalRevision===recordedRevision;
}

/** All DsN 6.4.1 private integration lives here. Previews never enter physics. */
export function createDsnAdapter({dice3d,onSettled,onBoxChanged=()=>{},onFailure=()=>{},
  getSessionForDie=()=>null,user=globalThis.game?.user,utils=globalThis.foundry?.utils,
  getActor=id=>globalThis.game?.actors?.get(id),
  interaction=globalThis.canvas?.mouseInteractionManager,hooks=globalThis.Hooks,
  nativePersistentEnabled=()=>globalThis.game?.settings.get('dice-so-nice','persistentDice')}) {
  let box=null,boxGeneration=0,disposed=false,held=null,grabEpoch=0,grabPromise=null,lifecycleBound=false,trayCanvas=null;
  const owned=new Map(),pending=new Set(),meshBatch=new WeakMap(),patches=[],trayGroups=new Set(),features=[],removingLegacy=new Set(),releases=new Map(),moves=new Set();
  const taskDiePrefix=`pd-die:${user?.id}:`,isTaskId=id=>typeof id==='string'&&id.startsWith(taskDiePrefix);
  let legacyHook=null;
  const localGuest=opts=>opts?.guest?.pendingId?.startsWith(TASK_PREFIX)&&
    opts.guest.reservedForUserId===user.id&&opts.ownerUserId===user.id;
  async function removeLegacy(owner,all=false) {
    await Promise.all([...owner.persistentDiceList].filter(mesh=>all||!localGuest({
      guest:mesh.userData.guest?{pendingId:mesh.userData.guestPendingId,reservedForUserId:mesh.userData.reservedForUserId}:null,
      ownerUserId:mesh.userData.ownerUserId})).map(async mesh=>{
      if(removingLegacy.has(mesh)) return;removingLegacy.add(mesh);
      try {await owner.removePersistentDie(mesh.userData.persistentId);} finally {removingLegacy.delete(mesh);}
    }));
  }
  function restoreFeature(owner) {
    const feature=features.find(f=>f.owner===owner);if(!feature) return;
    const setting=nativePersistentEnabled();
    owner.persistentDiceEnabled=setting===undefined?feature.enabled:owner.allowInteractivity&&setting;
  }
  const current=record=>!disposed&&record.boxGeneration===boxGeneration&&
    record.session.mode==='public'&&record.session.isCurrent(record.token);
  function patch(object,key,make) {
    const original=object[key],hadOwn=Object.hasOwn(object,key),replacement=make(original.bind(object));
    object[key]=replacement;patches.push({object,key,original,hadOwn,replacement});
  }
  const lookup=mesh=>owned.get(mesh.userData?.persistentId)??getSessionForDie(mesh.userData?.persistentId);
  function refreshTrayCanvas() {
    const next=trayGroups.size?dice3d?.canvas:null;if(next===trayCanvas) return;
    trayCanvas?.classList.remove('pd-tray-mounted');trayCanvas=next;
    trayCanvas?.classList.add('pd-tray-mounted');
  }
  function bindLifecycle() {
    if(lifecycleBound) return;lifecycleBound=true;
    patch(dice3d.persistent,'_emitPersistentEvent',original=>(type,event)=>{
      const ids=[...(event?.data?.persistentIds??[]),event?.data?.persistentId,
        ...(event?.data?.positions??[]).map(position=>position.persistentId)];
      if(type==='move'&&!event?.data?.positions?.length) return;
      if(ids.some(isTaskId)) return;
      return original(type,event);
    });
    const manager=dice3d.pendingThrows,nativeClaim=manager.claimThrow;
    patch(manager,'shouldStampInteractive',original=>message=>
      message.rolls?.some(roll=>roll.options?.pdPhysicalRevision)?false:original(message));
    if(hooks) legacyHook=hooks.on('dice-so-nice.persistentDiceChanged',()=>{
      if(!disposed&&box) void removeLegacy(box).catch(error=>console.warn('Persistent Dice: legacy cleanup',error));
    });
    patch(manager,'claimThrow',original=>(meshes,primaries,linked)=>{
      if(!meshes.length||!meshes.every(mesh=>{const r=lookup(mesh);return r&&current(r);}))
        return original(meshes,primaries,linked);
      // Borrow native guest RNG, without offering these task dice to unrelated cards.
      const isolated=Object.assign(Object.create(manager),{pending:new Map(),refreshEligibility:()=>{}});
      return nativeClaim.call(isolated,meshes,primaries,linked);
    });
    patch(dice3d,'_buildDiceBox',original=>(...args)=>{
      const result=original(...args);
      void api.ready().catch(error=>console.warn('Persistent Dice: box rebuild',error));
      return result;
    });
    patch(dice3d,'_fadeOutCanvas',original=>(duration,complete)=>{
      if(!trayGroups.size) return original(duration,complete);
      dice3d._cancelCanvasFade();box.fadeOutEphemeral(duration);
    });
  }
  function bindScene() {
    const owner=box;
    features.push({owner,enabled:owner.persistentDiceEnabled});owner.persistentDiceEnabled=true;
    patch(owner,'spawnPersistentDie',original=>(type,appearance,position,library,opts)=>
      localGuest(opts)?original(type,appearance,position,library,opts):null);
    patch(owner,'clearScene',original=>(...args)=>{
      ++boxGeneration;for(const group of trayGroups) owner.scene.remove(group);
      for(const record of owned.values()) record.session.cancel('scene cleared');
      void cancelGrab().catch(()=>{});owned.clear();return original(...args);
    });
    const restored=()=>{
      if(disposed||owner!==box) return;
      for(const group of trayGroups) if(group.parent!==owner.scene) owner.scene.add(group);
      onBoxChanged(owner,boxGeneration);
    };
    patch(owner,'setScene',original=>(...args)=>{const result=original(...args);restored();return result;});
    patch(owner,'update',original=>async(...args)=>{const result=await original(...args);restored();return result;});
  }
  function capture(data) {
    if(!data.heldDice?.length||!data.primaries?.length) return null;
    const records=data.heldDice.map(lookup),first=records[0];
    if(!first||!current(first)||records.some(r=>!r||r.session.id!==first.session.id||
      r.token.generation!==first.token.generation||!current(r))) return null;
    const logical=data.roll?.dice.flatMap(term=>term.results.map(r=>r.result))??data.primaries.map(mesh=>{
      const faces=lookup(mesh)?.descriptor.faces,places=COMPOUND[faces];
      if(!places) return data.forcedByMesh.get(mesh);
      const siblings=data.heldDice.filter(d=>d===mesh||d.userData.linkGroupId===mesh.userData.linkGroupId);
      const value=siblings.reduce((sum,d)=>sum+data.forcedByMesh.get(d)*places[d===mesh?0:d.userData.digitPlace]?.[1],0);
      return value===0?faces:value;
    });
    if(logical.length!==data.primaries.length) return null;
    const values=[];
    for(let i=0;i<data.primaries.length;i++) {
      const mesh=data.primaries[i],record=lookup(mesh),value=logical[i];
      const faces=record.descriptor?.faces??record.session.descriptors.find(d=>d.key===record.key)?.faces;
      if(!Number.isInteger(value)||value<1||value>faces) return null;
      const places=COMPOUND[faces];
      const siblings=data.heldDice.filter(d=>d===mesh||(mesh.userData.linkGroupId&&
        d.userData.linkGroupId===mesh.userData.linkGroupId));
      for(const d of siblings) {
        const place=d===mesh?0:d.userData.digitPlace;
        const expected=places?Math.floor(value/places[place]?.[1])%10:value;
        if(data.forcedByMesh.get(d)!==expected) return null;
      }
      values.push(Object.freeze({persistentId:mesh.userData.persistentId,value}));
    }
    return {token:first.token,record:first,meshes:[...data.heldDice],values:Object.freeze(values),
      roll:data.roll??{total:logical.reduce((sum,n)=>sum+n,0)},forced:new Map(data.forcedByMesh),
      initialPt:new Map(data.heldDice.map(d=>[d,d.persistentThrow])),completion:null,landed:false};
  }
  function bindQueue() {
    const owner=box,manager=owner.persistentDiceManager,engine=owner.throwEngine;
    patch(owner,'onMouseMove',original=>(...args)=>{
      if(!owner.inputHandler.mouse.heldPersistentDice.some(mesh=>isTaskId(mesh.userData?.persistentId))) return original(...args);
      const operation=Promise.resolve(original(...args));moves.add(operation);
      return operation.finally(()=>moves.delete(operation));
    });
    patch(manager,'throwPersistentDice',original=>(meshes,...args)=>{
      if(meshes.length&&meshes.every(mesh=>isTaskId(mesh.userData?.persistentId))&&
        meshes.some(mesh=>{const record=lookup(mesh);return !record||!current(record);})) return;
      return original(meshes,...args);
    });
    patch(manager,'onQueueThrow',original=>async data=>{
      const batch=capture(data);if(!batch) return original(data);
      pending.add(batch);for(const mesh of batch.meshes) meshBatch.set(mesh,batch);
      try {
        const queued=await original({...data,roll:null});
        if(batch.completion) await batch.completion;
        if(queued&&batch.landed&&current(batch.record)) onSettled(batch.token,[...batch.values]);
        else if(current(batch.record)) onFailure(batch.token);
        return queued;
      } catch(error) {if(current(batch.record)) onFailure(batch.token);throw error;}
      finally {
        pending.delete(batch);
        for(const mesh of batch.meshes) if(meshBatch.get(mesh)===batch) meshBatch.delete(mesh);
      }
    });
    patch(engine,'handlePersistentThrowCompletion',original=>function(...args) {
      const proved=[...pending].filter(batch=>batch.meshes.every(mesh=>
        mesh.persistentThrow&&mesh.persistentThrow!==batch.initialPt.get(mesh)&&
        mesh.parent&&mesh.sim?.stepPositions&&mesh.sim?.stepQuaternions&&
        mesh.forcedResult===batch.forced.get(mesh)));
      const completion=Promise.resolve().then(()=>original(...args));
      for(const batch of proved) batch.completion=completion.then(()=>{batch.landed=true;});
      return completion;
    });
    // Preserve advanced whole-roll effects without restoring the auxiliary chat carrier.
    patch(manager,'matchSFX',original=>(meshes,sfx,roll)=>{
      const groups=new Map(),ordinary=[];
      for(const mesh of meshes) {
        const batch=meshBatch.get(mesh);
        if(!batch) ordinary.push(mesh);
        else {const list=groups.get(batch)??[];list.push(mesh);groups.set(batch,list);}
      }
      if(ordinary.length||!groups.size) original(ordinary,sfx,roll);
      for(const [batch,list] of groups) original(list,sfx,batch.roll);
    });
    patch(box,'onMouseUp',original=>async event=>{
      if(!held) return original(event);
      if(event?.type==='pointercancel'||!current(held)) {await cancelGrab();return true;}
      const release=held;held=null;release.session.setFlight(release.token);
      const operation=Promise.resolve().then(()=>original(event));releases.set(operation,release);
      try {return await operation;} finally {releases.delete(operation);}
    });
  }
  function resolveAppearance(descriptor,type=`d${descriptor.faces}`) {
    const factory=dice3d.DiceFactory,U=dice3d.exports.Utils;
    const clone=value=>utils.duplicate(value??{});
    const merge=(a,b)=>utils.mergeObject(a,b,{applyOperators:true});
    const color=String(user.color);
    let raw={global:{labelColor:U.contrastOf(color),diceColor:color,outlineColor:color,
      edgeColor:color,texture:'none',material:'auto',font:'auto',colorset:'custom',system:'standard'}};
    if(!user.getFlag('dice-so-nice','saved')?.appearance) {
      const defaults=factory.getRole('basic')?.defaults;
      if(defaults&&!utils.isEmpty(defaults)) raw=merge(raw,U.sanitizeAppearance(clone(defaults),user));
    }
    raw=merge(raw,clone(user.getFlag('dice-so-nice','appearance')));delete raw.dimensions;
    const actor=descriptor.actorId?getActor(descriptor.actorId):null;
    const actorAppearance=actor?.getFlag('dice-so-nice','appearance');
    if(actorAppearance) raw=merge(raw,clone(actorAppearance));
    raw=U.sanitizeAppearance(raw,user);
    const options=clone(descriptor.termOptions);
    if(descriptor.flavor) options.type??=descriptor.flavor;
    const notation={type,options,termModifiers:[...(descriptor.termModifiers??[])]};
    notation.role=factory.detectRole(notation);
    if(user.getFlag('dice-so-nice','settings')?.enableFlavorColorset===false) {
      if(factory.getRole(notation.role)?.optional) notation.role='basic';
      delete notation.options.flavor;delete notation.options.type;
    }
    let scopes=clone(user.getFlag('dice-so-nice','roleAppearance'));
    const actorScopes=actor?.getFlag('dice-so-nice','roleAppearance');
    if(actorScopes) scopes=merge(scopes,clone(actorScopes));
    scopes=U.sanitizeRoleScopes(scopes,user);
    return {role:notation.role,appearance:factory.getAppearanceForDice(raw,type,notation,
      dice3d.persistent._persistentRoleContext(user,scopes)),_rawAppearances:raw,_rawRoleScopes:scopes,
      diceLibrary:dice3d.diceLibrary.constructor.getLibraryForUser(user)};
  }
  async function cleanupConstraints(record) {
    if(!record) return;
    const input=record.box.inputHandler,mouse=input.mouse,meshes=record.meshes;
    const mine=new Set(meshes),onlyMine=mouse.heldPersistentDice.every(d=>mine.has(d));
    if(onlyMine) input._resetPreRollState();
    mouse.heldPersistentDice=mouse.heldPersistentDice.filter(d=>!mine.has(d));
    mouse.pendingThrowDice=mouse.pendingThrowDice.filter(d=>!mine.has(d));
    if(mouse.pendingGrab&&mine.has(mouse.pendingGrab.root)) mouse.pendingGrab=null;
    if(!mouse.heldPersistentDice.length) {
      mouse.constraintDown=false;mouse.constraint=false;mouse.dragPositions=[];
    }
    for(const mesh of meshes) {
      delete mesh.userData.pickupOffset;mesh.userData.preRollRates=null;
      mesh.userData.constrained=false;delete mesh.userData.localGrabTime;
    }
    await record.box.physicsWorker.exec('removeConstraint',{ids:meshes.map(d=>d.id)});
    input.onPersistentEvent?.('release',{data:{persistentIds:meshes.map(d=>d.userData.persistentId)}});
    if(!mouse.heldPersistentDice.length) {
      interaction?.activate();
      if(interaction?.object&&record.interactiveBefore!==undefined)
        interaction.object.interactive=record.interactiveBefore;
    }
  }
  async function cancelGrab(token) {
    if(token&&(!held||held.token.sessionId!==token.sessionId||held.token.generation!==token.generation)) return;
    const previous=held;held=null;++grabEpoch;
    await grabPromise?.catch(()=>{});
    await cleanupConstraints(previous);
  }
  const api={
    get box(){return box;},get canvas(){return dice3d.canvas;},get boxGeneration(){return boxGeneration;},
    get ownedCount(){return owned.size;},ownership:id=>owned.get(id)??null,
    positionForSample(sample) {
      const rect=dice3d.canvas.getBoundingClientRect(),raycaster=box.diceScene.raycaster;
      raycaster.setFromCamera({x:2*(sample.clientX-rect.left)/rect.width-1,
        y:1-2*(sample.clientY-rect.top)/rect.height},box.camera);
      const ray=raycaster.ray,target=box.camera.position.clone();
      ray.at(-ray.origin.y/ray.direction.y,target);
      return box.toPositionPct(target.x,target.z);
    },
    setGrabScale(progress) {
      if(!held) return;
      for(const mesh of held.meshes) {
        const record=lookup(mesh);record.normalScale??=mesh.scale.clone();
        mesh.scale.copy(record.normalScale).multiplyScalar(.3+.7*progress);
      }
    },
    async ready() {
      if(disposed) return false;
      const next=dice3d?.box;if(!next) return false;await next.ready;
      const i=next?.inputHandler,m=next?.persistentDiceManager,e=next?.throwEngine;
      if(!dice3d.persistent?.spawn||!dice3d.persistent?.remove||!dice3d.persistent?._emitPersistentEvent||!dice3d.pendingThrows?.claimThrow||
        !dice3d.pendingThrows?.shouldStampInteractive||!next.spawnPersistentDie||!next.removePersistentDie||
        next.allowInteractivity===false||!i?._beginPersistentGrab||!i?._activatePreRoll||!i?._resetPreRollState||
        !m?.onQueueThrow||!m?.matchSFX||!m?.throwPersistentDice||!e?.handlePersistentThrowCompletion||
        !e?.createDiceMesh||!next?.renderScene||
        !dice3d.exports?.Utils||!dice3d.DiceFactory?.getAppearanceForDice||!utils||!user) return false;
      if(box===next) {refreshTrayCanvas();return true;}
      const previous=box;
      if(previous) {
        restoreFeature(previous);
        for(const group of trayGroups) previous.scene.remove(group);
        for(const record of owned.values()) record.session.cancel('box rebuilt');
        await cancelGrab();owned.clear();
      }
      if(disposed||dice3d.box!==next) return false;
      box=next;++boxGeneration;bindQueue();bindScene();bindLifecycle();
      await removeLegacy(box,true);
      for(const group of trayGroups) box.scene.add(group);
      refreshTrayCanvas();
      onBoxChanged(box,boxGeneration);return true;
    },
    async createPreview(descriptor) {
      const owner=box,generation=boxGeneration;
      const appearance=resolveAppearance(descriptor);
      const cache={...owner.renderer.scopedTextureCache,type:'bridge-tray-preview'};
      const created=await owner.throwEngine.createDiceMesh(`d${descriptor.faces}`,
        appearance.appearance,appearance.diceLibrary,cache);
      return !disposed&&generation===boxGeneration?created?.dicemesh??null:null;
    },
    async spawn(session,descriptor,positionPct) {
      const record={session,token:{sessionId:session.id,generation:session.generation},
        descriptor,key:descriptor.key,boxGeneration};
      if(!current(record)||session.userId!==user.id) return null;
      const places=COMPOUND[descriptor.faces]??[[`d${descriptor.faces}`,1]],created=[];
      const linkGroupId=places.length>1?`${session.id}:${session.generation}:${descriptor.key}`:null;
      for(let n=0;n<places.length;n++) {
        const type=places[n][0],appearance=resolveAppearance(descriptor,type);
        const mesh=await dice3d.persistent.spawn(type,positionPct,{...appearance,
          remotePersistentId:`${taskDiePrefix}${globalThis.crypto.randomUUID()}`,
          guest:{pendingId:`${TASK_PREFIX}${session.id}`,reservedForUserId:session.userId},linkGroupId,
          linkGroupSecondary:n>0,digitPlace:n,ownerUserId:session.userId},false);
        if(mesh) created.push(mesh);
        if(!mesh||!current(record)) {
          for(const die of created) {
            owned.delete(die.userData.persistentId);
            await dice3d.persistent.remove(die.userData.persistentId,false);
          }
          return null;
        }
        owned.set(mesh.userData.persistentId,{...record,mesh});
      }
      const primary=created[0];
      if(!session.attachDie(record.token,descriptor.key,primary.userData.persistentId)) {
        await api.removeSession(session.id);return null;
      }
      return primary;
    },
    async beginGrab(session,meshes,sample) {
      const input=box.inputHandler,mouse=input.mouse;
      if(held||mouse.constraintDown||mouse.heldPersistentDice.length) return false;
      const token={sessionId:session.id,generation:session.generation};
      const expanded=[...owned.values()].filter(r=>r.session.id===session.id&&current(r)).map(r=>r.mesh);
      if(!expanded.length||meshes.some(d=>!expanded.includes(d))) return false;
      const record={session,token,boxGeneration,box,meshes:expanded,
        interactiveBefore:interaction?.object?.interactive};
      held=record;const epoch=++grabEpoch,rect=dice3d.canvas.getBoundingClientRect();
      mouse.pos.set(2*(sample.clientX-rect.left)/rect.width-1,
        1-2*(sample.clientY-rect.top)/rect.height);
      mouse.pendingGrab=null;mouse.constraintDown=true;
      if(interaction?.object) interaction.object.interactive=false;
      grabPromise=input._beginPersistentGrab(expanded,{x:0,y:.15,z:0});
      try {
        await grabPromise;
        if(epoch!==grabEpoch||!current(record)) {await cleanupConstraints(record);return false;}
        input._activatePreRoll();return true;
      } catch(error) {held=null;await cleanupConstraints(record);throw error;}
      finally {grabPromise=null;}
    },
    moveGrab(sample) {
      if(!held||!current(held)) return;
      const rect=dice3d.canvas.getBoundingClientRect();
      return box.onMouseMove(sample,{x:2*(sample.clientX-rect.left)/rect.width-1,
        y:1-2*(sample.clientY-rect.top)/rect.height});
    },
    async releaseGrab() {
      if(!held) return false;
      return box.onMouseUp({type:'pointerup'});
    },cancelGrab,
    async removeSession(sessionId,token) {
      if(held?.session.id===sessionId) await cancelGrab(token);
      await Promise.allSettled([...releases].filter(([,record])=>record.session.id===sessionId&&
        (!token||record.token.generation===token.generation)).map(([operation])=>operation));
      const records=[...owned.entries()].filter(([,r])=>r.session.id===sessionId&&
        (!token||r.token.generation===token.generation));
      for(const [id] of records) owned.delete(id);
      for(const [id] of records) await dice3d.persistent.remove(id,false);
    },
    mountTray(group) {
      const owner=box;trayGroups.add(group);owner.scene.add(group);
      refreshTrayCanvas();owner.renderScene();
      return ()=>{trayGroups.delete(group);box?.scene.remove(group);
        refreshTrayCanvas();box?.renderScene();};
    },renderTray(){if(!disposed) box?.renderScene();},
    async dispose() {
      if(disposed) return;disposed=true;++boxGeneration;await cancelGrab();
      await Promise.allSettled([...releases.keys()]);
      await Promise.allSettled([...moves]);
      for(const id of new Set([...owned.values()].map(r=>r.session.id))) await api.removeSession(id);
      for(const group of trayGroups) box?.scene.remove(group);
      trayGroups.clear();refreshTrayCanvas();
      if(legacyHook!==null) hooks.off('dice-so-nice.persistentDiceChanged',legacyHook);
      for(const {owner} of features) restoreFeature(owner);
      for(const {object,key,original,hadOwn,replacement} of patches.reverse()) if(object[key]===replacement) {
        if(hadOwn) object[key]=original;else delete object[key];
      }
      box?.renderScene();
    }
  };
  return api;
}
