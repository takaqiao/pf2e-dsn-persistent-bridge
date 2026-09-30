export function deferred() {
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
export function makeDsnRuntime({queueResult=true,simulate=true,mergeExtra=null,spawnWait=null,remoteCreateWait=null}={}) {
  let id=0;
  const flags={appearance:{global:{diceColor:'#123456'}},saved:{appearance:true}};
  const user={id:'u',color:'#abcdef',getFlag:(scope,key)=>flags[key]};
  const runtime={flags,user,removed:[],chats:[],physics:[],sfxRolls:[],spawnCalls:[],renderCalls:0};
  runtime.utils={duplicate:structuredClone,isEmpty:o=>!Object.keys(o).length,
    mergeObject(target,source){for(const [key,value] of Object.entries(source??{})) {
      target[key]=value&&typeof value==='object'&&!Array.isArray(value)?
        this.mergeObject(target[key]??{},value):value;
    }return target;}};
  runtime.exports={Utils:{contrastOf:()=> '#ffffff',sanitizeAppearance:o=>o,sanitizeRoleScopes:o=>o}};
  runtime.DiceFactory={getRole:()=>({defaults:{},optional:false}),
    detectRole:n=>n.options.type?`damage:${n.options.type}`:'basic',
    getAppearanceForDice:raw=>structuredClone(raw.global)};
  class Library {static getLibraryForUser(){return {};}}
  runtime.diceLibrary=new Library();
  const scene={children:[],add(group){this.children.push(group);},remove(group){
    this.children=this.children.filter(x=>x!==group);}};
  const mesh=(type,opts={})=>({id:++id,notation:{type},userData:{persistentId:`die-${id}`,
    ownerUserId:opts.ownerUserId??'u',linkGroupId:opts.linkGroupId,
    linkGroupSecondary:opts.linkGroupSecondary??false,digitPlace:opts.digitPlace},
    parent:{visible:true,position:{x:0,y:0,z:0}},geometry:{},material:{}});
  const worker={async exec(name,args){runtime.physics.push([name,args]);}};
  const input={mouse:{pos:{set(x,y){this.x=x;this.y=y;}},heldPersistentDice:[],
    pendingThrowDice:[],dragPositions:[],constraintDown:false,pendingGrab:null},
    async _beginPersistentGrab(meshes) {
      if(runtime.grabWait) await runtime.grabWait.promise;
      for(const d of meshes) await worker.exec('addConstraint',{id:d.id});
      this.mouse.heldPersistentDice=meshes;this.mouse.constraint=true;
    },_activatePreRoll(){this.mouse.preRoll=true;},_resetPreRollState(){this.mouse.preRoll=false;},
    onPersistentEvent(){}};
  const manager={persistentDiceList:[],persistentDiceVisibility:'all',physicsWorker:worker,
    matchSFX(dice,sfx,roll){runtime.sfxRolls.push(roll);},
    _applyPersistentDieVisibility(d){d.parent.visible=this.persistentDiceVisibility==='all'||
      (this.persistentDiceVisibility==='mine'&&d.userData.ownerUserId==='u');},
    async replayRemoteThrow(dice,velocity,forcedByMesh,sfxList) {
      return this.onQueueThrow({heldDice:dice,primaries:dice,velocity,forcedByMesh,sfxList,roll:null});
    }};
  const engine={persistentDiceList:manager.persistentDiceList,
    async createDiceMesh(type,appearance,library,cache) {
      runtime.previewArgs={type,appearance,library,cache};return {dicemesh:mesh(type),diceobj:{},mass:1};
    },async startUnifiedBatch(throws,data) {
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
  runtime.box={ready:Promise.resolve(),scene,inputHandler:input,persistentDiceManager:manager,
    throwEngine:engine,physicsWorker:worker,renderer:{scopedTextureCache:{type:'board'}},
    renderScene(){runtime.renderCalls++;},async onMouseMove(){},
    async onMouseUp(){input.mouse.constraintDown=false;input.mouse.heldPersistentDice=[];return true;},
    fromPositionPct:p=>({x:p.x-.5,z:.5-p.y}),toPositionPct:(x,z)=>({x:x+.5,y:.5-z}),
    replayRemoteThrow:(...args)=>manager.replayRemoteThrow(...args),
    fadeOutEphemeral(){},clearScene(){},setScene(){},async update(){}};
  runtime.canvas={classList:{add(){},remove(){}},style:{},
    getBoundingClientRect:()=>({left:0,top:0,width:1000,height:800})};
  runtime._buildDiceBox=function(){return this.box;};runtime._fadeOutCanvas=()=>{};
  runtime._cancelCanvasFade=()=>{};
  runtime.pendingThrows={pending:new Map(),claimThrow(){return null;},refreshEligibility(){}};
  runtime.persistent={_persistentRoleContext:()=>({}),
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
      if(spawnWait) await spawnWait.promise;
      const d=mesh(type,opts);manager.persistentDiceList.push(d);return d;
    },async remove(persistentId){runtime.removed.push(persistentId);
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
