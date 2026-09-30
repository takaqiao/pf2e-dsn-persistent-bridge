import {createBridge} from '../../scripts/main.js';
import {installPf2eBridge} from '../../scripts/pf2e-dialogs.js';
import {makeDie,makeCheckRoll} from './pf2e-rolls.mjs';
import {deferred} from './dsn-runtime.mjs';
class CheckModifiersDialog {constructor(root){this.id=1;this.element=[root];this.context={domains:['skill'],messageMode:'public'};this.check={totalModifier:4};}}
class CheckRoll {}
export async function makeBridgeHarness() {
  const hooksMap=new Map(),wrappers=new Map(),hooks={on(n,f){hooksMap.set(n,f);return n;},off(n){hooksMap.delete(n);}};
  const wrapper={register(id,n,f){wrappers.set(n,f);},unregister(id,n){wrappers.delete(n);}};
  let diceCount=1;
  class Parser {constructor(){this.dice=[makeDie(20,7,diceCount)];}}
  let callbacks,submitCount=0,app,session,gate,nativePrivatePath=false,lastRoll=null;
  const adapter={boxGeneration:1,ownedCount:0,async ready(){return true;},async removeSession(){this.ownedCount=0;},
    async cancelGrab(){},async dispose(){this.disposed=true;},renderTray(){}};
  const view={element:{},mount(){},setSize(){},show(){},clear(){},setState(){},dispose(){this.disposed=true;},layout(){}};
  let cancelled=0;
  const bridge=createBridge({userId:'u',versions:{foundry:'14.368',pf2e:'8.5.1',dsn:'6.4.1'},
    getSetting:key=>key==='enabled'||key==='autoSubmitOnFill'?true:220,
    dice3d:options=>{callbacks=options;return adapter;},view:()=>view,
    gestures:()=>Object.assign(async()=>{cancelled++;},{cancel:async()=>{cancelled++;}}),
    pf2e:options=>installPf2eBridge({...options,hooks,wrapper,game:{pf2e:{Check:{}}},
      config:{Dice:{rolls:[CheckRoll]},PF2E:{}},RollClass:Parser})});
  await bridge.enable();
  return {bridge,adapter,view,get cancelled(){return cancelled;},get submitCount(){return submitCount;},
    get nativePrivatePath(){return nativePrivatePath;},get lastRoll(){return lastRoll;},
    getSnapshot:()=>bridge.getSnapshot(session.id),
    openPublicCheck(count=1){
      diceCount=count;
      const root=new EventTarget();root.querySelector=()=>root;root.matches=()=>true;
      root.requestSubmit=()=>{submitCount++;root.dispatchEvent(new Event('submit'));};
      app=new CheckModifiersDialog(root);gate=deferred();
      const run=wrappers.get('game.pf2e.Check.roll')(async()=>{
        hooksMap.get('renderCheckModifiersDialog')(app,[root],{});
        session=bridge.getSession();await gate.promise;
        const roll=makeCheckRoll();roll.dice[0].number=diceCount;roll.options.domains=app.context.domains;
        nativePrivatePath=app.context.messageMode!=='public';
        await wrappers.get('globalThis.__pf2eDsnBridge.CheckRoll.prototype.evaluate').call(roll,()=>roll.evaluate(),[]);
        lastRoll=roll;
      },{},app.context);run.catch(e=>{throw e;});
      root.addEventListener('submit',()=>{app.isResolved=true;hooksMap.get('closeCheckModifiersDialog')(app);gate.resolve();});
      return session;
    },setMessageMode(mode){app.context.messageMode=mode;app.element[0].dispatchEvent(new Event('change'));},
    async deliverLanding(token,value){session.attachDie(token,session.descriptors[0].key,'die');
      callbacks.onSettled(token,[{persistentId:'die',value}]);for(let n=0;n<20;n++) await Promise.resolve();},
    nativeSubmit(){app.element[0].requestSubmit();},close(){hooksMap.get('closeCheckModifiersDialog')(app);},
    async flush(){for(let n=0;n<30;n++) await Promise.resolve();},
    async evaluateUnboundNativeRoll(roll){return wrappers.get('globalThis.__pf2eDsnBridge.CheckRoll.prototype.evaluate').call(roll,()=>roll.evaluate(),[]);}};
}
