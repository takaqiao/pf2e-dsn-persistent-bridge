export function makeDie(faces,randomValue=4,number=1,options={}) {
  return {faces,number,options,modifiers:[],results:[],roll() {
    const result={result:randomValue,active:true}; this.results.push(result);return result;
  }};
}
export function makeCheckRoll(options={}) {
  return {options,dice:[makeDie(20,11)],async evaluate() {
    for(const die of this.dice) for(let n=0;n<die.number;n++) die.roll();return this;
  }};
}
