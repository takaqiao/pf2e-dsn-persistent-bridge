export function deferred() {
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
export function makeDsnRuntime({queueResult=true,simulate=true,mergeExtra=null,spawnWait=null,remoteCreateWait=null,persistentEnabled=true,allowInteractivity=true,releaseWait=null}={}) {
  let id=0,variant=0;
  const flags={appearance:{global:{diceColor:'#123456'}},saved:{appearance:true}};
  const user={id:'u',color:'#abcdef',getFlag:(scope,key)=>flags[key]};
  const runtime={flags,user,removed:[],removeCalls:[],events:[],chats:[],physics:[],sfxRolls:[],spawnCalls:[],renderCalls:0};
  const materials=new Map(),geometries=new Map();
  const resourcesFor=(type,appearance={},cache)=>{
    const index=Array.isArray(appearance.background)?variant++%appearance.background.length:0;
    const choose=value=>Array.isArray(value)?value[index%value.length]:value;
    const materialData={};
    for(const key of ['background','foreground','outline','edge','texture','material','font','fontScale']) {
      if(appearance[key]!==undefined) materialData[key]=choose(appearance[key]);
    }
    materialData.background??=appearance.diceColor;
    materialData.foreground??=appearance.labelColor;
    if(typeof materialData.texture==='string') materialData.texture={name:materialData.texture,id:materialData.texture};
    else if(materialData.texture&&!materialData.texture.id) materialData.texture={name:'',texture:''};
    const materialKey=JSON.stringify([cache.type,type,...['background','foreground','outline','edge','material','font'].map(key=>materialData[key]),
      materialData.texture?.name,materialData.texture?.composite,appearance.system,appearance.systemSettings]);
    if(!materials.has(materialKey)) materials.set(materialKey,{userData:{materialData},disposed:false,dispose(){this.disposed=true;}});
    const geometryKey=JSON.stringify([['board','persistent'].includes(cache.type)?'board':'showcase',type]);
    if(!geometries.has(geometryKey)) geometries.set(geometryKey,{disposed:false,dispose(){this.disposed=true;}});
    return {material:materials.get(materialKey),geometry:geometries.get(geometryKey)};
  };
  const listeners=new Map();runtime.hooks={on(name,fn){listeners.set(fn,name);return fn;},off(name,fn){listeners.delete(fn);},
    callAll(name){for(const [fn,event] of listeners) if(name===event) fn();}};
  runtime.utils={duplicate:structuredClone,isEmpty:o=>!Object.keys(o).length,
    mergeObject(target,source){for(const [key,value] of Object.entries(source??{})) {
      target[key]=value&&typeof value==='object'&&!Array.isArray(value)?
        this.mergeObject(target[key]&&typeof target[key]==='object'?target[key]:{},value):value;
    }return target;}};
  runtime.exports={Utils:{contrastOf:()=> '#ffffff',sanitizeAppearance:o=>o,sanitizeRoleScopes:o=>o}};
  runtime.DiceFactory={getRole:()=>({defaults:{},optional:false}),
    detectRole:n=>n.options.type?`damage:${n.options.type}`:'basic',
    getAppearanceForDice:raw=>structuredClone(raw.global)};
  class Library {static getLibraryForUser(){return {};}}
  runtime.diceLibrary=new Library();
  const scene={children:[],add(group){this.children.push(group);},remove(group){
    this.children=this.children.filter(x=>x!==group);}};
  const mesh=(type,opts={})=>({id:++id,notation:{type},userData:{persistentId:opts.remotePersistentId??`die-${id}`,
    ownerUserId:opts.ownerUserId??'u',guest:Boolean(opts.guest),guestPendingId:opts.guest?.pendingId,
    reservedForUserId:opts.guest?.reservedForUserId,linkGroupId:opts.linkGroupId,
    linkGroupSecondary:opts.linkGroupSecondary??false,digitPlace:opts.digitPlace},
    parent:{visible:true,position:{x:0,y:0,z:0}},geometry:{},material:{}});
  const worker={async exec(name,args){runtime.physics.push([name,args]);}};
  const input={mouse:{pos:{set(x,y){this.x=x;this.y=y;}},heldPersistentDice:[],
    pendingThrowDice:[],dragPositions:[],constraintDown:false,pendingGrab:null},
    async _beginPersistentGrab(meshes) {
      if(runtime.grabWait) await runtime.grabWait.promise;
      for(const d of meshes) await worker.exec('addConstraint',{id:d.id});
      this.mouse.heldPersistentDice=meshes;this.mouse.constraint=true;
      runtime.persistent._emitPersistentEvent('pickup',{data:{persistentIds:meshes.map(d=>d.userData.persistentId)}});
    },_activatePreRoll(){this.mouse.preRoll=true;for(const d of this.mouse.heldPersistentDice) d.userData.preRollRates={x:1,y:1,z:1};},
    _computeThrowVelocity(){return {x:1,y:1,z:1};},_resetPreRollState(){this.mouse.preRoll=false;},
    onPersistentEvent(type,data){runtime.persistent._emitPersistentEvent(type,data);}};
  const manager={persistentDiceList:[],persistentDiceVisibility:'all',physicsWorker:worker,
    _getPersistentTextureCache(){return this._persistentTextureCache??={...runtime.box.renderer.scopedTextureCache,type:'persistent'};},
    async throwPersistentDice(meshes){runtime.persistent._emitPersistentEvent('throw',
      {data:{persistentIds:meshes.map(d=>d.userData.persistentId),results:[{forcedResult:17}]}});},
    matchSFX(dice,sfx,roll){runtime.sfxRolls.push(roll);},
    _applyPersistentDieVisibility(d){d.parent.visible=this.persistentDiceVisibility==='all'||
      (this.persistentDiceVisibility==='mine'&&d.userData.ownerUserId==='u');},
    async replayRemoteThrow(dice,velocity,forcedByMesh,sfxList) {
      return this.onQueueThrow({heldDice:dice,primaries:dice,velocity,forcedByMesh,sfxList,roll:null});
    }};
  const engine={persistentDiceList:manager.persistentDiceList,
    async createDiceMesh(type,appearance,library,cache) {
      runtime.previewArgs={type,appearance,library,cache};
      if(runtime.previewWait) await runtime.previewWait.promise;
      const d=Object.assign(mesh(type),resourcesFor(type,appearance,cache));
      return {dicemesh:d,diceobj:{},mass:1};
    },getVectors(notation,vector,boost,dist){runtime.vectorCalls??=[];runtime.vectorCalls.push({notation,vector,boost,dist});return notation;},
    async startUnifiedBatch(throws,data) {
      if(!simulate) return;
      let first=true;
      for(const d of data.heldDice) {
        d.forcedResult=data.forcedByMesh.get(d);
        d.sim={stepPositions:new Float32Array(3),stepQuaternions:new Float32Array(4)};
        d.persistentThrow={roll:first?data.roll:null};first=false;
      }
      manager.matchSFX(data.heldDice,data.sfxList??[],data.roll);
    },async handlePersistentThrowCompletion() {
      for(const d of manager.persistentDiceList) {
        if(d.persistentThrow?.roll) await d.persistentThrow.roll.toMessage();
        delete d.persistentThrow;delete d.sim;
      }
    }};
  runtime.box={ready:Promise.resolve(),scene,inputHandler:input,persistentDiceManager:manager,persistentDiceEnabled:persistentEnabled,allowInteractivity,
    get persistentDiceList(){return manager.persistentDiceList;},
    async spawnPersistentDie(type,appearance,pct,library,opts){
      if(!this.persistentDiceEnabled) return null;
      if(spawnWait) await spawnWait.promise;
      const d=Object.assign(mesh(type,opts),resourcesFor(type,appearance,manager._getPersistentTextureCache()));
      manager.persistentDiceList.push(d);
      runtime.hooks.callAll('dice-so-nice.persistentDiceChanged');return d;
    },async removePersistentDie(id){manager.persistentDiceList.splice(0,manager.persistentDiceList.length,
      ...manager.persistentDiceList.filter(d=>d.userData.persistentId!==id));},
    throwEngine:engine,physicsWorker:worker,renderer:{scopedTextureCache:{type:'board'}},
    renderScene(){runtime.renderCalls++;},async onMouseMove(){},
    async onMouseUp(){const meshes=[...input.mouse.heldPersistentDice],velocity=meshes.length&&input.mouse.preRoll?input._computeThrowVelocity(true):null;
      runtime.lastComputedVelocity=velocity;input.mouse.constraintDown=false;input.mouse.heldPersistentDice=[];
      if(releaseWait) await releaseWait.promise;
      if(velocity) {
        runtime.releaseVelocity=velocity;await manager.throwPersistentDice(meshes,velocity);
      }return true;},
    fromPositionPct:p=>({x:p.x-.5,z:.5-p.y}),toPositionPct:(x,z)=>({x:x+.5,y:.5-z}),
    replayRemoteThrow:(...args)=>manager.replayRemoteThrow(...args),
    fadeOutEphemeral(){},clearScene(){},setScene(){},async update(){}};
  const classes=new Set();
  runtime.canvas={classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},style:{},
    getBoundingClientRect:()=>({left:0,top:0,width:1000,height:800})};
  runtime._buildDiceBox=function(){return this.box;};runtime._fadeOutCanvas=()=>{};
  runtime._cancelCanvasFade=()=>{};
  runtime.pendingThrows={pending:new Map(),claimThrow(){return null;},refreshEligibility(){},shouldStampInteractive(){return true;}};
  runtime.persistent={_persistentRoleContext:()=>({}),
    _emitPersistentEvent(type,data){runtime.events.push([type,data]);},
    async handleMessage(request){
      runtime.remoteCreated??=new Set();runtime.remoteReplays??=[];
      if(request.type==='persistent-create') {
        if(remoteCreateWait) await remoteCreateWait.promise;
        runtime.remoteCreated.add(request.data.persistentId);
      } else if(request.type==='persistent-throw') {
        for(const id of request.data.persistentIds) if(runtime.remoteCreated.has(id)) runtime.remoteReplays.push(id);
      } else if(request.type==='persistent-remove') {
        for(const id of request.data.persistentIds) runtime.remoteCreated.delete(id);
      }
    },
    async spawn(type,pct,opts,sync){
      runtime.spawnCalls.push({type,pct,opts,sync});
      return runtime.box.spawnPersistentDie(type,opts.appearance,pct,opts.diceLibrary,opts);
    },async remove(persistentId,sync){runtime.removed.push(persistentId);runtime.removeCalls.push([persistentId,sync]);
      manager.persistentDiceList.splice(0,manager.persistentDiceList.length,
        ...manager.persistentDiceList.filter(d=>d.userData.persistentId!==persistentId));
    }};
  runtime.queue={async enqueuePersistent(data) {
    runtime.lastEnqueue=data;
    const merged=mergeExtra?{...data,heldDice:[...data.heldDice,mergeExtra.mesh],
      primaries:[...data.primaries,mergeExtra.mesh],roll:data.roll??mergeExtra.roll,
      forcedByMesh:new Map([...data.forcedByMesh,[mergeExtra.mesh,3]])}:data;
    if(mergeExtra&&!manager.persistentDiceList.includes(mergeExtra.mesh)) manager.persistentDiceList.push(mergeExtra.mesh);
    await runtime.box.throwEngine.startUnifiedBatch([],merged);
    if(simulate) await runtime.box.throwEngine.handlePersistentThrowCompletion();
    return queueResult;
  }};
  manager.onQueueThrow=data=>runtime.queue.enqueuePersistent(data);
  runtime.triggerOwnedThrow=async (meshes,values)=> {
    const primaries=meshes.filter(d=>!d.userData.linkGroupSecondary);
    const results=values.map(result=>({result,active:true}));
    const forced=new Map();
    for(let n=0;n<primaries.length;n++) {
      const d=primaries[n],value=values[n];
      forced.set(d,d.notation.type==='d100'?Math.floor(value/10)%10:value);
      for(const secondary of meshes.filter(x=>x.userData.linkGroupId&&
        x.userData.linkGroupId===d.userData.linkGroupId&&x.userData.linkGroupSecondary)) forced.set(secondary,value%10);
    }
    const roll={dice:[{results}],total:values.reduce((a,b)=>a+b,0),
      async toMessage(){runtime.chats.push('owned');}};
    return manager.onQueueThrow({heldDice:meshes,primaries,velocity:{x:1,y:1,z:0},forcedByMesh:forced,roll});
  };
  runtime.mesh=mesh;return runtime;
}
