import {normalizeThrowDirection} from './throw-direction.js';

/** A dialog owns its dice, generation and one immutable submission. */
export function createSession({id,appId,userId,kind,mode,descriptors}) {
  let generation=0, status='open', items=copyDescriptors(descriptors),throwDirection=null;
  const attached=new Map(), values=new Map();
  const terminal=()=>status==='cancelled'||status==='submitted';
  const isCurrent=token=>Boolean(token && token.sessionId===id &&
    token.generation===generation && !terminal());
  const reset=()=>{generation++;attached.clear();values.clear();throwDirection=null;};

  return Object.freeze({
    id,appId,userId,kind,
    get mode(){return mode;},
    get generation(){return generation;},
    get status(){return status;},
    get descriptors(){return items;},
    get complete(){return items.length>0 && values.size===items.length;},
    isCurrent,
    startBatch() {
      if(terminal() || mode!=='public' || !items.length ||
        status==='grabbing' || status==='flying') return null;
      reset(); status='grabbing';
      return Object.freeze({sessionId:id,generation});
    },
    attachDie(token,key,persistentId) {
      if(!isCurrent(token) || status!=='grabbing' || !persistentId ||
        attached.has(persistentId) || [...attached.values()].includes(key) ||
        !items.some(d=>d.key===key)) return false;
      attached.set(persistentId,key); return true;
    },
    setThrowDirection(token,direction) {
      if(!isCurrent(token)||status!=='grabbing'||mode!=='public') return false;
      const normalized=normalizeThrowDirection(direction);if(!normalized) return false;
      throwDirection=normalized;return true;
    },
    setFlight(token) {
      if(!isCurrent(token) || status!=='grabbing') return false;
      status='flying'; return true;
    },
    settle(token,results) {
      if(!isCurrent(token) || !['grabbing','flying'].includes(status) ||
        !Array.isArray(results) || !results.length) return false;
      const staged=new Map();
      for(const {persistentId,value} of results) {
        const key=attached.get(persistentId), descriptor=items.find(d=>d.key===key);
        if(!descriptor || staged.has(key) || !Number.isInteger(value) ||
          value<1 || value>descriptor.faces) return false;
        staged.set(key,value);
      }
      for(const [key,value] of staged) values.set(key,value);
      status='settled'; return true;
    },
    prepareSubmit() {
      if(terminal()) return null;
      const snapshot=Object.freeze({id,kind,mode,
        descriptors:copyDescriptors(items),
        values:Object.freeze([...values].map(([key,value])=>Object.freeze({key,value}))),
        ...(values.size&&throwDirection?{throwDirection}:{})});
      generation++; attached.clear(); throwDirection=null;status='submitted';
      return snapshot;
    },
    replace(next) {
      if(terminal()) return;
      items=copyDescriptors(next.descriptors); mode=next.mode;
      reset(); status='open';
    },
    cancel() {reset();status='cancelled';}
  });
}

function copyDescriptors(descriptors) {
  const keys=new Set();
  return Object.freeze(descriptors.map(d=>{
    if(!d.key || keys.has(d.key) || !Number.isInteger(d.faces) || d.faces<2)
      throw new TypeError('Invalid dice descriptor');
    keys.add(d.key);
    return Object.freeze(structuredClone(d));
  }));
}
