const ID='pf2e-dsn-persistent-bridge';
function assertQA() {
  if(!['localhost','127.0.0.1'].includes(location.hostname)||location.port!=='38120'||
    game.world.id!=='pf2e-dsn-bridge-qa') throw new Error('Only the isolated tray QA world is allowed');
}
export async function idleSample(duration=5000) {
  assertQA();const box=game.dice3d.box,ticker=canvas.app.ticker,worker=box.physicsWorker;
  const add=ticker.add,exec=worker.exec;let tickerAdd=0,playStep=0;
  ticker.add=function(fn,...args){if(fn===box.animateThrow) tickerAdd++;return add.call(this,fn,...args);};
  worker.exec=function(name,...args){if(name==='playStep') playStep++;return exec.call(this,name,...args);};
  try {
    await new Promise(resolve=>setTimeout(resolve,duration));
    const host=game.dice3d.canvas,style=getComputedStyle(host);
    return {caseId:'idle-5s',ok:tickerAdd===0&&playStep===0&&style.display!=='none'&&style.opacity!=='0',
      evidence:{tickerAdd,playStep,display:style.display,opacity:style.opacity,
        diagnose:game.modules.get(ID).api.diagnose()}};
  } finally {ticker.add=add;worker.exec=exec;}
}
export async function churn(open,count=50) {
  assertQA();
  for(let i=0;i<count;i++) {
    const roll=open();
    let app;
    for(let n=0;n<100;n++) {
      app=Object.values(ui.windows).find(a=>a.constructor.name==='CheckModifiersDialog');
      if(app?.rendered&&app.element?.[0]) break;await new Promise(resolve=>setTimeout(resolve,20));
    }
    if(!app?.rendered) throw new Error(`Native dialog ${i} did not open`);
    await app.close();await roll;
  }
  const diagnosis=game.modules.get(ID).api.diagnose(),mouse=game.dice3d.box.inputHandler.mouse;
  return {caseId:'dialog-churn-50',ok:diagnosis.sessionCount===0&&diagnosis.ownedInstanceCount===0&&
    mouse.heldPersistentDice.length===0&&!mouse.constraintDown,
    evidence:{count,diagnosis,held:mouse.heldPersistentDice.length,constraintDown:mouse.constraintDown}};
}
export function snapshot(caseId) {
  assertQA();const dsn=game.dice3d;
  return {caseId,versions:{foundry:game.version,pf2e:game.system.version,dsn:game.modules.get('dice-so-nice').version},
    diagnosis:game.modules.get(ID).api.diagnose(),
    host:{tag:dsn.canvas.tagName,display:getComputedStyle(dsn.canvas).display,opacity:getComputedStyle(dsn.canvas).opacity},
    taskDice:dsn.box.persistentDiceList.filter(d=>d.userData.guest).map(d=>({type:d.notation.type,
      face:d.forcedResult,persistentId:d.userData.persistentId})),
    messages:game.messages.contents.filter(m=>m.isRoll).map(m=>({id:m.id,
      mode:m.messageMode,blind:m.blind,rolls:m.rolls.map(r=>({formula:r.formula,total:r.total,
        revision:r.options.pdPhysicalRevision??null,dice:r.dice.map(d=>({faces:d.faces,results:d.results}))}))}))};
}
