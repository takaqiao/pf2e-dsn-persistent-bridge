import {MOD_ID,SETTINGS,getSetting as readSetting,warn} from './constants.js';
import {createSession} from './session.js';
import {createDsnAdapter,shouldSuppressRevision} from './dsn-adapter.js';
import {createTrayView} from './tray-view.js';
import {createGestureController} from './gestures.js';
import {installPf2eBridge} from './pf2e-dialogs.js';
import {registerSettings,migrateSettings} from './settings.js';
import {registerPf2eColorsets} from './pf2e-colorsets.js';
import {describeDice} from './descriptors.js';
import {evaluateWithSnapshot} from './result-bridge.js';

/** Dependency factories make enabling create fresh resources after a full teardown. */
export function createBridge({pf2e,dice3d,view,gestures,getSetting,userId=globalThis.game?.user?.id,
  versions={},onPhysicalRoll=()=>{},getMessageMode=()=>globalThis.game?.settings.get('core','messageMode')??'public'}) {
  const apps=new Map(),records=new Map(),snapshots=new Map();
  let adapter=null,tray=null,controller=null,uninstall=null,enabled=false,enabling=null,active=null;
  const modeOf=app=>{const mode=app.context?.messageMode??getMessageMode();return mode==='ic'?'public':mode;};
  const formOf=app=>{const root=app.element?.[0]??app.element;
    return root?.matches?.('form')?root:root?.querySelector?.('form');};
  const showing=()=>active?.session&&!['submitted','cancelled'].includes(active.session.status)?active.session:null;
  function paint() {
    if(!tray) return;
    const s=showing();
    if(s&&['grabbing','flying'].includes(s.status)) {tray.clear();tray.setState('grabbing');return;}
    void tray.show(s);
    if(active&&!active.canBind) tray.setState('unsupported');
  }
  function focus(app) {
    const record=apps.get(app);if(!record) return;
    if(active!==record&&showing()&&['grabbing','flying'].includes(showing().status)) return;
    active=record;paint();
  }
  function submit(app) {
    const record=apps.get(app);if(!record?.session||record.submitting) return;
    record.submitting=true;const snapshot=record.session.prepareSubmit();
    if(snapshot) snapshots.set(record.session.id,snapshot);
    void controller?.cancel();void adapter.removeSession(record.session.id);paint();
  }
  function openDialog(app,result) {
    if(!enabled) return null;
    let record=apps.get(app);const mode=modeOf(app);
    if(record) {
      if(record.session&&record.session.status!=='submitted'&&
        (record.fingerprint!==result.fingerprint||record.session.mode!==mode||record.canBind!==result.canBind)) {
        const old={sessionId:record.session.id,generation:record.session.generation};
        record.session.replace({mode,descriptors:result.canBind?result.descriptors:[]});
        void controller?.cancel();void adapter.removeSession(record.session.id,old);
      }
      record.fingerprint=result.fingerprint;record.canBind=result.canBind;focus(app);return record.session;
    }
    const session=result.canBind?createSession({id:globalThis.crypto.randomUUID(),appId:app.id,userId,
      kind:app.constructor.name==='CheckModifiersDialog'?'check':'damage',mode,descriptors:result.descriptors}):null;
    record={app,session,fingerprint:result.fingerprint,canBind:result.canBind,submitting:false};
    apps.set(app,record);if(session) records.set(session.id,record);focus(app);return session;
  }
  function closeDialog(app,submitted) {
    const record=apps.get(app);if(!record) return;
    if(submitted) submit(app);
    else if(record.session) {
      record.session.cancel('closed');records.delete(record.session.id);snapshots.delete(record.session.id);
      void controller?.cancel();void adapter.removeSession(record.session.id);
    }
    apps.delete(app);record.app=null;
    if(active===record) {active=[...apps.values()].at(-1)??null;paint();}
  }
  const api={openDialog,changeDialog:openDialog,closeDialog,getSession:showing,
    getSnapshot(id) {
      if(!snapshots.has(id)) {const r=records.get(id);if(r?.app) submit(r.app);}
      return snapshots.get(id)??null;
    },
    async enable() {
      if(enabled) return;if(enabling) return enabling;
      enabling=(async()=>{
        if(getSetting(SETTINGS.enabled)===false) return;
        adapter=dice3d({onSettled(token,values) {
          const record=records.get(token.sessionId);if(!record?.session.settle(token,values)) return;
          void adapter.removeSession(record.session.id,token);paint();
          if(record.session.complete&&getSetting(SETTINGS.autoSubmitOnFill)!==false&&!record.submitting)
            formOf(record.app)?.requestSubmit();
        },onFailure(token) {
          const r=records.get(token.sessionId);if(!r?.session.isCurrent(token)) return;
          r.session.replace({mode:r.session.mode,descriptors:r.session.descriptors});
          void adapter.removeSession(r.session.id,token);paint();
        },onBoxChanged() {if(tray) {tray.layout();paint();}}});
        if(!await adapter.ready()) {await adapter.dispose();adapter=null;throw new Error('DsN interface unavailable');}
        tray=await view({adapter});tray.mount();tray.setSize(getSetting(SETTINGS.traySize)??220);
        enabled=true;
        controller=gestures({element:tray.element,adapter,getSession:showing,onState(state) {
          if(state==='held') {tray.clear();tray.setState('grabbing');}
          else if(state==='armed') tray.setState('armed');
          else if(state==='idle') paint();
        }});
        uninstall=pf2e({onDialog:openDialog,onFocus:focus,onClose:closeDialog,onSubmit:submit,
          getSnapshot:api.getSnapshot,onEvaluated(session,success,roll) {
            if(success&&roll?.options?.pdPhysicalRevision) onPhysicalRoll(roll);
            snapshots.delete(session.id);const r=records.get(session.id);records.delete(session.id);
            if(r?.app) apps.delete(r.app);void adapter.removeSession(session.id);
            if(active===r) {active=[...apps.values()].at(-1)??null;paint();}
            if(!success) globalThis.ui?.notifications?.warn(globalThis.game?.i18n.localize('PD.NotSubmitted'));
          }});
      })().finally(()=>{enabling=null;});return enabling;
    },
    async disable() {
      if(enabling) await enabling.catch(()=>{});enabled=false;uninstall?.();uninstall=null;
      for(const r of records.values()) r.session.cancel('disabled');
      await controller?.();controller=null;apps.clear();records.clear();snapshots.clear();active=null;
      tray?.dispose();tray=null;await adapter?.dispose();adapter=null;
    },
    refresh(){tray?.setSize(getSetting(SETTINGS.traySize)??220);},
    diagnose(){return {versions,capabilities:{enabled,dsn:Boolean(adapter),dialogs:Boolean(uninstall)},
      sessionCount:records.size,ownedInstanceCount:adapter?.ownedCount??0,
      activeMode:showing()?.mode??null,dialogCount:apps.size};}
  };return api;
}

export function installMessageSuppression(hooks=globalThis.Hooks,game=globalThis.game,document=globalThis.document) {
  const revisions=new Set(),ids=[];
  ids.push(['deleteChatMessage',hooks.on('deleteChatMessage',m=>{
    for(const roll of m.rolls??[]) revisions.delete(roll.options?.pdPhysicalRevision);
  })]);
  ids.push(['diceSoNiceMessagePreProcess',hooks.on('diceSoNiceMessagePreProcess',(id,interception)=>{
    const message=game.messages.get(id);
    if(game.settings?.get('dice-so-nice','animateInlineRoll')&&message?.content?.includes('inline-roll')) {
      const content=document.createElement('div');content.innerHTML=message.content;
      if(content.querySelector('.inline-roll.inline-result:not(.inline-dsn-hidden)')) return;
    }
    const rolls=message?.rolls?.filter(roll=>roll.dice?.length)??[];
    if(message?.author?.id===game.user.id&&rolls.length&&rolls.every(r=>
      shouldSuppressRevision(r,r.options?.pdPhysicalRevision)&&revisions.has(r.options.pdPhysicalRevision)))
      interception.willTrigger3DRoll=false;
  })]);
  return Object.assign(()=>{for(const [name,id] of ids) hooks.off(name,id);revisions.clear();},
    {remember(roll) {const revision=roll.options?.pdPhysicalRevision;if(!revision||roll.options.pdPhysicalComplete!==true) return;
      revisions.add(revision);if(revisions.size>200) revisions.delete(revisions.values().next().value);}});
}

export async function runChecks(RollClass=globalThis.Roll) {
  const results=[];
  for(const [formula,value] of [['1d20',17],['1d100',100]]) {
    const roll=new RollClass(formula),descriptors=describeDice(roll),snapshot={id:'diagnostic',mode:'public',descriptors,
      values:[{key:descriptors[0].key,value}]};
    await evaluateWithSnapshot(roll,snapshot,()=>roll.evaluate(),[]);
    results.push({name:formula,passed:roll.dice[0].results[0].result===value});
  }return results;
}

if(globalThis.Hooks) {
  let bridge=null,suppression=null,sync=Promise.resolve();
  const versions=()=>({foundry:game.version,pf2e:game.system.version,dsn:game.modules.get('dice-so-nice')?.version});
  const minimum=(actual,required)=>actual&&!foundry.utils.isNewerVersion(required,actual);
  function synchronize() {
    sync=sync.then(async()=>{
      if(readSetting(SETTINGS.enabled)===false) {await bridge?.disable();suppression?.();suppression=null;return;}
      if(bridge?.diagnose().capabilities.enabled) {bridge.refresh();return;}
      const v=versions();
      if(game.system.id!=='pf2e'||!game.modules.get('lib-wrapper')?.active||!game.modules.get('dice-so-nice')?.active||
        !game.dice3d?.box?.ready||
        !minimum(v.foundry,'14.361')||!minimum(v.pf2e,'8.5.1')||!minimum(v.dsn,'6.4.1')) return;
      await migrateSettings();
      await registerPf2eColorsets(game.dice3d);
      bridge=createBridge({versions:v,getSetting:readSetting,onPhysicalRoll:roll=>suppression?.remember(roll),pf2e:options=>installPf2eBridge(options),
        dice3d:options=>createDsnAdapter({dice3d:game.dice3d,...options}),
        view:async({adapter})=>createTrayView({adapter,THREE:await import(foundry.utils.getRoute('modules/dice-so-nice/libs/three.module.min.js'))}),
        gestures:options=>createGestureController(options)});
      await bridge.enable();suppression??=installMessageSuppression();
      game.modules.get(MOD_ID).api={diagnose:()=>bridge.diagnose(),runChecks};
    }).catch(error=>{warn(error);void bridge?.disable();});return sync;
  }
  Hooks.once('init',()=>registerSettings(()=>void synchronize()));
  Hooks.once('ready',()=>{game.modules.get(MOD_ID).api={diagnose:()=>bridge?.diagnose()??{versions:versions(),capabilities:{enabled:false},sessionCount:0,ownedInstanceCount:0},runChecks};void synchronize();});
  Hooks.on('diceSoNiceReady',()=>void synchronize());
  for(const name of ['canvasReady','collapseSidebar']) Hooks.on(name,()=>bridge?.refresh());
}
