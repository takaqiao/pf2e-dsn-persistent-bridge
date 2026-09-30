/** The same choice PF2e 8.5.1 makes immediately before constructing CheckRoll. */
export function checkDiceFormula(context) {
  const sub=context.substitutions?.find(s=>s.selected);
  const twice=context.isReroll?false:context.rollTwice;
  const options=new Set(context.options??[]);
  if(sub?.effectType) options.add(sub.effectType);
  if(twice==='keep-higher') options.add('fortune');
  if(twice==='keep-lower') options.add('misfortune');
  if(options.has('fortune')&&options.has('misfortune')) return '1d20';
  if(sub) return String(sub.value);
  return twice==='keep-higher'?'2d20kh':twice==='keep-lower'?'2d20kl':'1d20';
}

export function diceEntries(roll) {
  const compound=Boolean(roll.instances?.length),instances=compound?roll.instances:[roll];
  return instances.flatMap((instance,i)=>{
    if(instance.persistent&&!instance.options?.evaluatePersistent) return [];
    return (instance.dice??[]).map((term,j)=>({term,termPath:`${i}/${j}`,
      flavor:(compound?instance.type:null)??term.options?.flavor??null}));
  });
}

export function describeDice(roll) {
  return diceEntries(roll).flatMap(({term,termPath,flavor})=>
    Array.from({length:term.number??1},(_,ordinal)=>({
      key:`${termPath}:${ordinal}:${term.faces}:${flavor??''}`,
      termPath,ordinal,faces:term.faces,flavor,
      termOptions:structuredClone(term.options??{}),termModifiers:[...(term.modifiers??[])]
    })));
}

/** Parse native final instance markup, never formulaData's pre-critical dice counts. */
export function describeDamageDialog(app,html,RollClass,{formula,
  damageTypes=globalThis.CONFIG?.PF2E?.damageTypes??{}}={}) {
  let source;
  if(typeof formula==='string') {
    const doc=html?.ownerDocument??globalThis.document;
    source=doc.createElement('div');source.innerHTML=formula;
  } else source=html?.querySelector('button[type="submit"]');
  const nodes=[...(source?.querySelectorAll('.damage.instance')??[])];
  if(!nodes.length) throw new Error('Missing native damage formula');
  const instances=nodes.map(node=>{
    const flavor=[...node.classList].find(name=>Object.hasOwn(damageTypes,name));
    if(!flavor) throw new Error('Unknown damage instance');
    const persistent=flavor==='bleed'||Boolean(node.querySelector('.fa-hourglass'));
    if(persistent&&!app.context?.evaluatePersistent) return {type:flavor,persistent:true,dice:[]};
    const clone=node.cloneNode(true);
    for(const icon of clone.querySelectorAll('i')) if(!icon.textContent.trim()) icon.remove();
    const expression=clone.textContent.replaceAll('×','*').replaceAll('−','-').trim();
    const parsed=new RollClass(expression);
    return {type:flavor,dice:parsed.dice,expression};
  });
  const descriptors=describeDice({instances});
  return {descriptors,fingerprint:JSON.stringify(instances.map(i=>
    [i.type,i.persistent??false,i.expression??'']))};
}
