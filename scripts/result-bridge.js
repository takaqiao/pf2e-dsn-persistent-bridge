import {diceEntries} from './descriptors.js';

/** Reference carriers keep identical concurrent native rolls independent. */
export function createRollBindings() {
  const checks=new WeakMap(),active=new WeakMap(),weapons=new WeakMap(),
    spells=new WeakMap(),exact=new WeakMap(),records=new Map();
  const live=s=>s&&s.status!=='cancelled'&&records.has(s.id)?s:null;
  function record(session,map,key) {
    if(!key||typeof key!=='object') return false;
    const previous=map.get(key);
    if(previous===session) return true;
    if(previous&&previous.id!==session.id) {
      previous.cancel('shared identity');session.cancel('shared identity');return false;
    }
    const r=records.get(session.id)??{session,carriers:[]};
    records.set(session.id,r);r.carriers.push([map,key]);map.set(key,session);return true;
  }
  return {
    beginCheck(context) {
      const running=active.get(context)??new Set(), first=running.values().next().value;
      const invocation={context,originalDomains:first?.originalDomains??context.domains,
        hadOwn:first?.hadOwn??Object.hasOwn(context,'domains'),channel:[...(context.domains??[])],
        blocked:running.size>0,session:null};
      if(running.size) for(const old of running) {
        old.blocked=true;old.session?.cancel('shared context');
      }
      context.domains=invocation.channel;checks.set(invocation.channel,invocation);
      running.add(invocation);active.set(context,running);return invocation;
    },
    endCheck(invocation) {
      const {context}=invocation;
      active.get(context)?.delete(invocation);
      if(context.domains===invocation.channel) {
        if(invocation.hadOwn) context.domains=invocation.originalDomains;
        else delete context.domains;
      }
      checks.delete(invocation.channel);
    },
    canBindCheck(app) {const i=checks.get(app.context.domains);return Boolean(i&&!i.blocked);},
    armCheck(app,session) {
      const i=checks.get(app.context.domains);
      if(!i||i.blocked) {session.cancel('unbound check');return false;}
      i.session=session;records.set(session.id,{session,carriers:[]});return true;
    },
    armWeaponDamage(app,session) {
      return record(session,weapons,app.formulaData.base)&&record(session,spells,app.context);
    },
    getSpellSession(context) {return live(spells.get(context));},
    bindSpellResult(result) {
      const session=live(spells.get(result?.context)),roll=result?.template?.damage?.roll;
      return Boolean(session&&roll&&record(session,exact,roll));
    },
    resolve(roll) {
      return live(exact.get(roll))??live(checks.get(roll.options?.domains)?.session)??
        live(weapons.get(roll.options?.damage?.damage?.base))??null;
    },
    release(id) {
      const record=records.get(id);
      for(const [map,key] of record?.carriers??[]) map.delete(key);
      records.delete(id);
    },
    clear() {
      for(const [id,{session}] of records) {
        session.cancel('disabled');this.release(id);
      }
    }
  };
}

let revision=0;
export async function evaluateWithSnapshot(roll,snapshot,wrapped,args) {
  roll.options??={};delete roll.options.pdPhysicalRevision;
  if(snapshot?.mode!=='public'||!snapshot.values?.length) return wrapped(...args);
  const entries=diceEntries(roll),byPath=new Map(entries.map(e=>[e.termPath,e]));
  const saved=[],queues=new Map();
  for(const {key,value} of snapshot.values) {
    const descriptor=snapshot.descriptors.find(d=>d.key===key),entry=byPath.get(descriptor?.termPath);
    if(!entry||entry.term.faces!==descriptor.faces||entry.flavor!==descriptor.flavor||
      !Number.isInteger(value)||value<1||value>descriptor.faces||
      descriptor.ordinal<0||descriptor.ordinal>=(entry.term.number??1))
      throw new Error('Dice changed before physical handoff');
    const queue=queues.get(entry.term)??new Map();
    if(queue.has(descriptor.ordinal)) throw new Error('Duplicate physical result');
    queue.set(descriptor.ordinal,value);queues.set(entry.term,queue);
  }
  try {
    for(const [term,values] of queues) {
      const original=term.roll,hadOwn=Object.hasOwn(term,'roll');let ordinal=0;
      saved.push({term,original,hadOwn});
      term.roll=function(options={}) {
        const index=ordinal++;
        if(!values.has(index)) return original.call(this,options);
        const result={result:values.get(index),active:true};this.results.push(result);return result;
      };
    }
    const result=await wrapped(...args);
    roll.options.pdPhysicalRevision=`${snapshot.id}:${Date.now()}:${++revision}`;
    return result;
  } finally {
    for(const {term,original,hadOwn} of saved) {
      if(hadOwn) term.roll=original;else delete term.roll;
    }
  }
}
