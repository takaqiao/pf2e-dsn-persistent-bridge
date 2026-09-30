import {deferred} from './dsn-runtime.mjs';
import {createSession} from '../../scripts/session.js';
import {createGestureController} from '../../scripts/gestures.js';
export function fakeClock() {
  let now=0,id=0;const pending=new Map();
  return {now:()=>now,setTimeout(fn,ms){pending.set(++id,{at:now+ms,fn});return id;},
    clearTimeout(timer){pending.delete(timer);},advance(ms){now+=ms;
      for(const [timer,item] of [...pending]) if(item.at<=now) {pending.delete(timer);item.fn();}}};
}
export function makeGestureHarness() {
  const clock=fakeClock(),element=new EventTarget(),window=new EventTarget(),spawns=[],states=[];
  element.ownerDocument={defaultView:window,activeElement:element};
  element.setPointerCapture=()=>{};element.releasePointerCapture=()=>{};
  element.getBoundingClientRect=()=>({left:0,top:0,width:200,height:200});
  let session=createSession({id:'s',appId:1,userId:'u',kind:'check',mode:'public',
    descriptors:[{key:'a',termPath:'0/0',ordinal:0,faces:20,flavor:null}]});
  const adapter={boxGeneration:1,spinCalls:0,releaseCalls:0,removed:[],moves:[],scales:[],
    positionForSample:()=>({x:.5,y:.5}),setGrabScale(progress){this.scales.push(progress);},
    spawn(s,d){const wait=deferred();spawns.push({wait,session:s});return wait.promise;},
    async beginGrab(){this.spinCalls++;return true;},moveGrab(sample){this.moves.push(sample);},
    async releaseGrab(){this.releaseCalls++;},async cancelGrab(){},
    async removeSession(id){for(const p of spawns) if(p.session.id===id&&p.mesh&&!this.removed.includes(p.mesh.id)) this.removed.push(p.mesh.id);}};
  const controller=createGestureController({element,adapter,getSession:()=>session,
    setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,now:clock.now,onState:(state)=>states.push(state)});
  let x=100,y=100;
  const dispatch=(type,props={},target=element)=>{
    const event=new Event(type,{cancelable:true});Object.assign(event,{clientX:x,clientY:y,pointerId:1,
      button:0,isPrimary:true,...props});target.dispatchEvent(event);
  };
  return {adapter,element,states,controller,get session(){return session;},
    pointerDown:props=>dispatch('pointerdown',props),pointerUp:()=>dispatch('pointerup'),
    pointerMove(dx,dy){x+=dx;y+=dy;dispatch('pointermove');},
    cancel:()=>dispatch('pointercancel'),blur:()=>dispatch('blur',{},window),
    keyDown:(repeat=false)=>dispatch('keydown',{code:'Space',repeat}),keyUp:()=>dispatch('keyup',{code:'Space'}),
    escape:()=>dispatch('keydown',{key:'Escape'},window),advance:clock.advance,
    resolveSpawn(id='die'){const p=spawns.find(p=>!p.mesh);if(p){p.mesh={id};p.wait.resolve(p.mesh);}},
    resolveAllSpawns(){spawns.forEach((p,i)=>{p.mesh={id:`die-${i}`};p.wait.resolve(p.mesh);});},
    failSpawn(){spawns[0].wait.resolve(null);},async flush(){for(let i=0;i<20;i++) await Promise.resolve();}};
}
