import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDiceFormula,describeDice,describeDamageDialog} from '../scripts/descriptors.js';
import {makeDie} from './fixtures/pf2e-rolls.mjs';

for(const [context,want] of [
  [{},'1d20'],[{rollTwice:'keep-higher'},'2d20kh'],[{rollTwice:'keep-lower'},'2d20kl'],
  [{rollTwice:'keep-higher',options:new Set(['misfortune'])},'1d20'],
  [{substitutions:[{selected:true,value:17,effectType:'fortune'}]},'17'],
  [{substitutions:[{selected:true,value:17,effectType:'fortune'}],rollTwice:'keep-lower'},'1d20'],
  [{isReroll:true,rollTwice:'keep-higher'},'1d20']
]) test(`check selection gives ${want} for ${JSON.stringify(context)}`,()=>{
  assert.equal(checkDiceFormula(context),want);
});

test('fortune has two ordered descriptors rather than one kept result',()=>{
  const dice=describeDice({dice:[makeDie(20,10,2)]});
  assert.deepEqual(dice.map(d=>[d.termPath,d.ordinal,d.faces]),[['0/0',0,20],['0/0',1,20]]);
  assert.notEqual(dice[0].key,dice[1].key);
});
test('damage instances preserve flavor and doubled dice count',()=>{
  const dice=describeDice({instances:[
    {type:'fire',dice:[makeDie(6,2,4)]},
    {type:'cold',dice:[makeDie(6,3,2)]}
  ]});
  assert.deepEqual(dice.map(d=>[d.termPath,d.ordinal,d.flavor]),[
    ['0/0',0,'fire'],['0/0',1,'fire'],['0/0',2,'fire'],['0/0',3,'fire'],
    ['1/0',0,'cold'],['1/0',1,'cold']]);
});
test('deferred persistent damage is not a visible physical input',()=>{
  const dice=describeDice({instances:[
    {type:'fire',persistent:true,options:{},dice:[makeDie(6)]},
    {type:'cold',dice:[makeDie(6)]}
  ]});
  assert.deepEqual(dice.map(d=>[d.termPath,d.flavor]),[['1/0','cold']]);
});
test('appearance options survive descriptor extraction without shared mutation',()=>{
  const options={flavor:'fire',appearance:{libraryDieId:'custom'}};
  const die=makeDie(6,4,1,options), [d]=describeDice({dice:[die]});
  options.appearance.libraryDieId='changed';
  assert.equal(d.termOptions.appearance.libraryDieId,'custom');
});
test('damage HTML expressions are parsed by native Roll and scoped by instance',()=>{
  const calls=[];
  class Parser {
    constructor(expression){calls.push(expression);this.dice=expression==='2 * (2d8 + 4)'?
      [makeDie(8,5,2)]:[makeDie(6,2)];}
  }
  const node=(type,text,persistent=false)=>({classList:[type,'damage','instance','color'],
    textContent:text,querySelector:()=>persistent?{}:null,cloneNode(){return {...this,
      querySelectorAll:()=>[],textContent:text};}});
  const nodes=[node('piercing','2 × (2d8 + 4)'),node('fire','1d6'),node('bleed','1d6')];
  const root={querySelector:()=>({querySelectorAll:()=>nodes})};
  const result=describeDamageDialog({context:{}},root,Parser,{damageTypes:{piercing:'',fire:'',bleed:''}});
  assert.deepEqual(calls,['2 * (2d8 + 4)','1d6']);
  assert.deepEqual(result.descriptors.map(d=>[d.termPath,d.faces,d.flavor]),
    [['0/0',8,'piercing'],['0/0',8,'piercing'],['1/0',6,'fire']]);
});
