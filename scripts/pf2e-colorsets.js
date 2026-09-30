import {MOD_ID} from './constants.js';
const PALETTE={electricity:['#fff200','#f1d505'],sonic:['#58f6ff','#2bb0b5'],vitality:['#a85a00','#fcf1c2'],
  void:['#b023e8','#2d002e'],spirit:['#ffadff','#313866'],mental:['#ffffff','#a448a4'],
  bleed:['#ffffff','#8b1111'],slashing:['#ffffff','#68717d'],piercing:['#ffffff','#746b54'],
  bludgeoning:['#ffffff','#70533b'],untyped:['#dddddd','#777777']};
/** Native 6.4.1 lacks these PF2e roles. Existing roles/colorsets always win. */
export async function registerPf2eColorsets(dice3d=globalThis.game?.dice3d) {
  if(!dice3d?.addColorset||!dice3d.DiceFactory) return;
  for(const [id,[foreground,background]] of Object.entries(PALETTE)) {
    if(!dice3d.exports.COLORSETS[id]) await dice3d.addColorset({name:id,
      description:`PF2E.Trait${id[0].toUpperCase()+id.slice(1)}`,category:'DICESONICE.DamageTypes',
      foreground,background,outline:'black',texture:'none',material:'auto'});
    if(!dice3d.DiceFactory.getRole(id)) dice3d.addRole({id,
      label:`PF2E.Trait${id[0].toUpperCase()+id.slice(1)}`,group:'DICESONICE.DamageTypes',optional:true,
      defaults:{global:{colorset:id}},detectors:{types:[id]}},{package:MOD_ID});
  }
}
