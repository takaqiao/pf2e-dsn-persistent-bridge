import {MOD_ID,warn} from './constants.js';
import {checkDiceFormula,describeDice,describeDamageDialog} from './descriptors.js';
import {createRollBindings,evaluateWithSnapshot} from './result-bridge.js';

export function supportsPhysicalDialog(app) {
  if(app.constructor.name==='CheckModifiersDialog') return Boolean(app.context&&app.check);
  if(app.constructor.name!=='DamageModifierDialog') return false;
  const context=app.context;
  return context?.type==='damage-roll'&&Boolean(context.self?.statistic)&&
    Boolean(context.self?.item?.isOfType('weapon','melee','spell'));
}

/** Native hooks observe the form; no replacement panel or submit handler. */
export function installPf2eBridge({onDialog,onClose,onFocus,getSnapshot,onSubmit=()=>{},
  onEvaluated=()=>{},hooks=globalThis.Hooks,wrapper=globalThis.libWrapper,
  game=globalThis.game,config=globalThis.CONFIG,RollClass=globalThis.Roll}) {
  const bindings=createRollBindings(),listeners=new Map(),hookIds=[],paths=[];
  function wrap(path,fn) {wrapper.register(MOD_ID,path,fn,'WRAPPER');paths.push(path);}
  function rootOf(app,html) {return app.element?.[0]??html?.[0]??html;}
  function removeListeners(app) {
    const old=listeners.get(app);
    if(old) for(const [event,fn,capture] of old.events) old.root.removeEventListener(event,fn,capture);
    listeners.delete(app);
  }
  function render(app,html,data={}) {
    const root=rootOf(app,html);if(!root) return;
    let result;
    try {
      const supported=supportsPhysicalDialog(app);
      if(!supported) result={descriptors:[],fingerprint:'unsupported',canBind:false};
      else if(app.constructor.name==='CheckModifiersDialog') {
        const formula=checkDiceFormula(app.context),roll=new RollClass(formula);
        result={descriptors:describeDice(roll),fingerprint:`${formula}:${app.check.totalModifier}`,
          canBind:bindings.canBindCheck(app)};
      } else result={...describeDamageDialog(app,root,RollClass,{formula:data.formula,
        damageTypes:config.PF2E.damageTypes}),canBind:true};
    } catch(error) {
      warn('Dialog dice unavailable',error.message);
      result={descriptors:[],fingerprint:'unavailable',canBind:false};
    }
    const actorId=app.context?.actor?.id??app.context?.self?.actor?.id;
    if(actorId) result.descriptors=result.descriptors.map(d=>({...d,actorId}));
    const session=onDialog(app,result);
    if(session?.id&&result.canBind) {
      if(app.constructor.name==='CheckModifiersDialog') bindings.armCheck(app,session);
      else bindings.armWeaponDamage(app,session);
    }
    removeListeners(app);
    const events=[['change',()=>render(app,root,data),false],
      ['pointerdown',()=>onFocus(app),false],['focusin',()=>onFocus(app),false],
      ['submit',()=>onSubmit(app),true]];
    for(const [event,fn,capture] of events) root.addEventListener(event,fn,capture);
    listeners.set(app,{root,events,session:session?.id?session:null});
  }
  for(const kind of ['CheckModifiersDialog','DamageModifierDialog']) {
    const name=`render${kind}`;hookIds.push([name,hooks.on(name,render)]);
    const close=`close${kind}`;
    hookIds.push([close,hooks.on(close,(app)=>{
      const session=listeners.get(app)?.session;
      removeListeners(app);
      const submitted=Boolean(app.isResolved||app.isRolled);
      if(session&&!submitted) bindings.release(session.id);
      onClose(app,submitted);
    })]);
  }
  wrap('game.pf2e.Check.roll',async function(wrapped,check,context={},...rest) {
    const invocation=bindings.beginCheck(context);
    try{return await wrapped(check,context,...rest);}
    finally{bindings.endCheck(invocation);}
  });
  const stash=globalThis.__pf2eDsnBridge??={};
  for(const name of ['CheckRoll','DamageRoll']) {
    const Class=config.Dice.rolls.find(c=>c.name===name);if(!Class) continue;
    stash[name]=Class;
    wrap(`globalThis.__pf2eDsnBridge.${name}.prototype.evaluate`,async function(wrapped,...args) {
      const session=bindings.resolve(this),snapshot=session?getSnapshot(session.id):null;
      try {
        const result=await evaluateWithSnapshot(this,snapshot,wrapped,args);
        if(session) onEvaluated(session,true,this);return result;
      } catch(error) {if(session) onEvaluated(session,false);throw error;}
      finally{if(session) bindings.release(session.id);}
    });
  }
  const spell=config.PF2E?.Item?.documentClasses?.spell;
  if(spell?.prototype?.getDamage) wrap('CONFIG.PF2E.Item.documentClasses.spell.prototype.getDamage',
    async function(wrapped,...args) {
      const result=await wrapped(...args);
      const session=result?.context?bindings.getSpellSession(result.context):null;
      if(session&&!result?.template?.damage?.roll&&getSnapshot(session.id)?.values.length) {
        bindings.release(session.id);onEvaluated(session,false);
        globalThis.ui?.notifications?.warn(globalThis.game?.i18n?.localize('PD.NotSubmitted')??'Roll not submitted');
        return null;
      }
      bindings.bindSpellResult(result);return result;
    });
  return ()=>{
    for(const app of [...listeners.keys()]) removeListeners(app);
    bindings.clear();
    for(const [name,id] of hookIds) hooks.off(name,id);
    for(const path of paths) wrapper.unregister(MOD_ID,path);
  };
}
