/** A gesture owns one session/token. Native DsN owns motion, RNG and landing. */
export function createGestureController({element,adapter,getSession,
  setTimeout=globalThis.setTimeout,clearTimeout=globalThis.clearTimeout,now=()=>performance.now(),onState=()=>{}}) {
  const window=element.ownerDocument.defaultView,listeners=[],timers=new Set();
  let active=null,epoch=0,disposed=false;
  const later=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;};
  const stopTimers=()=>{for(const id of timers) clearTimeout(id);timers.clear();};
  function announce(state,record=active,progress=null) {
    if(record) record.state=state;
    onState(state,{sessionId:record?.session.id??null,token:record?.token??null,progress});
  }
  const valid=r=>!disposed&&active===r&&r.epoch===epoch&&getSession()===r.session&&
    adapter.boxGeneration===r.boxGeneration&&r.session.mode==='public'&&
    (r.token?r.session.isCurrent(r.token):r.session.generation===r.initialGeneration)&&
    !['submitted','cancelled'].includes(r.session.status);
  function trimSamples(r,time) {
    while(r.samples.length>1&&r.samples[1].time<=time-200) r.samples.shift();
  }
  function recordSample(r,sample,time) {
    const validPoint=Number.isFinite(sample.clientX)&&Number.isFinite(sample.clientY);
    if(validPoint) {
      r.sample={clientX:sample.clientX,clientY:sample.clientY};
      const last=r.samples.at(-1);
      if(last.clientX!==sample.clientX||last.clientY!==sample.clientY) r.samples.push({...r.sample,time});
    }
    trimSamples(r,time);return validPoint;
  }
  function releaseCapture(r) {
    if(r?.pointerId!==null) try {element.releasePointerCapture(r.pointerId);} catch {}
  }
  async function clean(r,reset=true) {
    await adapter.cancelGrab(r.token);await adapter.removeSession(r.session.id,r.token);
    if(reset&&r.session.status!=='submitted'&&r.session.status!=='cancelled'&&r.session.isCurrent(r.token))
      r.session.replace({mode:r.session.mode,descriptors:r.session.descriptors});
  }
  async function cancel() {
    const r=active;if(!r) return;
    active=null;++epoch;stopTimers();releaseCapture(r);
    if(r.token&&r.session.isCurrent(r.token)) r.session.replace({mode:r.session.mode,descriptors:r.session.descriptors});
    if(r.token) await clean(r,false);announce('idle',r);
  }
  async function lift(r) {
    if(!valid(r)||r.state!=='armed') return;
    r.token=r.session.startBatch();if(!r.token) {await cancel();return;}
    announce('lifting',r,0);
    try {
      const position=adapter.positionForSample(r.sample);
      const results=await Promise.allSettled(r.session.descriptors.map(d=>adapter.spawn(r.session,d,position)));
      const meshes=results.filter(x=>x.status==='fulfilled').map(x=>x.value);
      if(!valid(r)) {await clean(r,false);if(active===r) await cancel();return;}
      if(results.some(x=>x.status==='rejected')||meshes.some(x=>!x)) {await cancel();return;}
      const grabbed=await adapter.beginGrab(r.session,meshes,r.sample);
      if(!valid(r)||!grabbed) {await clean(r,false);if(active===r) await cancel();return;}
      announce('held',r,0);adapter.setGrabScale?.(0);
      const started=now();
      const grow=()=>{
        if(!valid(r)||r.state!=='held') return;
        const progress=Math.min(1,(now()-started)/150);
        adapter.setGrabScale?.(progress);
        if(progress<1) later(grow,16);
      };later(grow,16);
    } catch(error) {console.warn('Persistent Dice: grab failed',error);if(active===r) await cancel();else await clean(r,false);}
  }
  function start(event,keyboard=false) {
    if(disposed||active||element.dataset?.state==='loading'||(!keyboard&&(event.button!==0||!event.isPrimary))) return;
    const session=getSession();if(!session||session.mode!=='public'||!session.descriptors.length||
      !['open','settled'].includes(session.status)) return;
    const rect=element.getBoundingClientRect();
    const sample=keyboard?{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}:event;
    if(!Number.isFinite(sample.clientX)||!Number.isFinite(sample.clientY)) return;
    if(sample.clientX<rect.left||sample.clientX>rect.left+rect.width||
      sample.clientY<rect.top||sample.clientY>rect.top+rect.height) return;
    event.preventDefault();event.stopPropagation();
    const r={session,epoch:++epoch,initialGeneration:session.generation,boxGeneration:adapter.boxGeneration,
      token:null,pointerId:keyboard?null:event.pointerId,sample:{clientX:sample.clientX,clientY:sample.clientY},
      origin:{clientX:sample.clientX,clientY:sample.clientY},
      samples:[{clientX:sample.clientX,clientY:sample.clientY,time:now()}],keyboard,state:'pressing'};
    active=r;if(!keyboard) element.setPointerCapture(event.pointerId);announce('pressing',r);
    later(()=>{if(!valid(r)) {void cancel();return;}announce('armed',r);if(keyboard) void lift(r);},300);
  }
  function move(event) {
    const r=active;if(!r||r.keyboard||event.pointerId!==r.pointerId) return;
    event.preventDefault();event.stopPropagation();
    if(!valid(r)) {void cancel();return;}
    if(!recordSample(r,event,now())) return;
    if(r.state==='armed'&&Math.hypot(event.clientX-r.origin.clientX,event.clientY-r.origin.clientY)>=12) void lift(r);
    else if(r.state==='held') void adapter.moveGrab(r.sample);
  }
  async function finish(event) {
    const r=active;if(!r||(!r.keyboard&&event.pointerId!==r.pointerId)) return;
    event.preventDefault();event.stopPropagation();
    if(r.state!=='held'||!valid(r)) {await cancel();return;}
    const releasedAt=now();
    if(r.keyboard) trimSamples(r,releasedAt);else recordSample(r,event,releasedAt);
    active=null;++epoch;stopTimers();releaseCapture(r);adapter.setGrabScale?.(1);announce('releasing',r);
    try {await adapter.releaseGrab(r.samples,releasedAt);announce('idle',r);}
    catch(error) {await clean(r);announce('idle',r);console.warn('Persistent Dice: release failed',error);}
  }
  const listen=(target,type,fn)=>{target.addEventListener(type,fn);listeners.push(()=>target.removeEventListener(type,fn));};
  listen(element,'pointerdown',e=>start(e));listen(element,'pointermove',move);listen(element,'pointerup',e=>void finish(e));
  listen(element,'pointercancel',()=>void cancel());listen(element,'lostpointercapture',()=>void cancel());
  listen(element,'keydown',e=>{if(e.code==='Space'&&!e.repeat&&element.ownerDocument.activeElement===element) start(e,true);});
  listen(element,'keyup',e=>{if(e.code==='Space'&&active?.keyboard) void finish(e);});
  listen(window,'keydown',e=>{if(e.key==='Escape'&&active) {e.preventDefault();void cancel();}});
  listen(window,'blur',()=>void cancel());
  const dispose=async()=>{if(disposed) return;await cancel();disposed=true;stopTimers();for(const remove of listeners) remove();};
  dispose.cancel=cancel;dispose.getState=()=>active?.state??'idle';return dispose;
}
