import { MOD_ID, SETTINGS, getSetting, log, warn } from "./constants.js";

/**
 * Auto-register PF2e damage-type colorsets into DSN.
 *
 * Why:
 *   DSN ships built-in colorsets named after D&D damage types
 *   (lightning, thunder, radiant, necrotic, ...). PF2e uses different
 *   names (electricity, sonic, vitality, void, ...). When a PF2e damage
 *   roll fires with `term.options.flavor = "electricity"`, DSN's
 *   `resolveDamageTypeMapping` falls back to `br[name]` — but `br` has
 *   no entry named "electricity", so no styling is applied. The end
 *   result: DSN's per-damage-type feature is effectively dead for ~11
 *   of PF2e's 16 damage types unless the user installs a third-party
 *   helper module (e.g. pf2e-dice-flavor-fix).
 *
 * Solution:
 *   At `diceSoNiceReady` time, register the PF2e damage types DSN is
 *   missing as colorsets. Each registration adds an entry to DSN's
 *   `br` map; subsequent rolls flow through DSN's normal styling
 *   pipeline with sensible defaults. Users can still override any of
 *   them via DSN's per-type configuration (damageTypeMap setting) —
 *   our registration is just the missing default.
 *
 * Skipped when:
 *   • Setting `registerPf2eColorsets` is off.
 *   • `pf2e-dice-flavor-fix` module is active — it registers a more
 *     thorough palette (with material colorsets too) and we don't want
 *     to clobber its choices.
 *   • A colorset of the same name already exists in DSN's `br` map
 *     (e.g. user has another module that registered it first).
 *
 * Reuses PF2e's existing `PF2E.TraitX` localization keys for the
 * colorset description so the picker reads natively in any language
 * the PF2e system supports.
 */

// Each entry: name (must match PF2e's term.options.flavor for that damage type),
// description (PF2e's own localization key — already translated by the system),
// foreground/background/outline/texture (visual config).
const PF2E_COLORSETS = [
  {
    name: "electricity",
    description: "PF2E.TraitElectricity",
    foreground: "#fff200",
    background: ["#f1d505", "#f2dc3a", "#ffcb21", "#fcd33a", "#ffd829"],
    outline: "black",
    texture: "ice",
  },
  {
    name: "sonic",
    description: "PF2E.TraitSonic",
    foreground: "#58F6FF",
    background: ["#2bb0b5", "#0dbbde", "#4ec2d9", "#009996", "#09b2b8"],
    outline: "black",
    texture: "stone",
  },
  {
    name: "vitality",
    description: "PF2E.TraitVitality",
    foreground: "#a85a00",
    background: ["#fcf1c2", "#edd987", "#eddea4", "#f7e9b0", "#f7e28b"],
    outline: "black",
    texture: "stone",
  },
  {
    name: "void",
    description: "PF2E.TraitVoid",
    foreground: "#b023e8",
    background: ["#2d002e", "#19031a", "#260726", "#23052b", "#2e0f3b", "#1b0221"],
    outline: "black",
    texture: "marble",
  },
  {
    name: "spirit",
    description: "PF2E.TraitSpirit",
    foreground: "#ffadff",
    background: ["#313866", "#504099", "#66409e", "#934fc3", "#8c2bb3"],
    outline: "black",
    texture: "stars",
  },
  {
    name: "mental",
    description: "PF2E.TraitMental",
    foreground: "#D6A8FF",
    background: ["#313866", "#504099", "#66409E", "#934FC3", "#C949FC", "#313866"],
    outline: "black",
    texture: "speckles",
  },
  {
    name: "bleed",
    description: "PF2E.TraitBleed",
    foreground: "#cc3f3f",
    background: ["#5c0000", "#470101", "#6D0101", "#470101", "#630c0c", "#801111"],
    outline: "black",
    texture: "marble",
  },
  {
    name: "slashing",
    description: "PF2E.TraitSlashing",
    foreground: "#FFFFFF",
    background: ["#bfbfbf", "#c9c9c9", "#b0b0b0", "#cccccc"],
    outline: "black",
    texture: "stone",
    material: "metal",
  },
  {
    name: "piercing",
    description: "PF2E.TraitPiercing",
    foreground: "#FFFFFF",
    background: ["#bfbfbf", "#c9c9c9", "#b0b0b0", "#cccccc"],
    outline: "black",
    texture: "paper",
    material: "metal",
  },
  {
    name: "bludgeoning",
    description: "PF2E.TraitBludgeoning",
    foreground: "#FFFFFF",
    background: ["#bfbfbf", "#c9c9c9", "#b0b0b0", "#cccccc"],
    outline: "black",
    texture: "speckles",
    material: "metal",
  },
  {
    name: "untyped",
    description: "PF2E.TraitUntyped",
    foreground: "#dddddd",
    background: ["#7a7a7a", "#888888", "#666666", "#7e7e7e"],
    outline: "black",
    texture: "none",
  },
];

// DSN's Damage Type Mapping config UI populates its rows by filtering `br`
// for `category === "DICESONICE.DamageTypes"`. To make our PF2e additions
// configurable in that UI (instead of just being silent fallback colorsets
// nobody can rebind), reuse DSN's own category string. They'll show up as
// rows alongside DSN's built-ins (fire / cold / acid / poison / etc.) and
// also appear in the colorset picker dropdown grouped under the same
// localized header DSN uses for its native damage types.
const DSN_DAMAGE_TYPE_CATEGORY = "DICESONICE.DamageTypes";

let registered = false;

export function registerPf2eColorsets() {
  if (registered) return;
  if (getSetting(SETTINGS.registerPf2eColorsets) === false) {
    log("pf2e-colorsets: disabled by setting");
    return;
  }
  if (game.modules.get("pf2e-dice-flavor-fix")?.active) {
    log("pf2e-colorsets: skipping — pf2e-dice-flavor-fix is active");
    registered = true;
    return;
  }

  const dice3d = game.dice3d;
  if (!dice3d || typeof dice3d.addColorset !== "function") {
    warn("pf2e-colorsets: dice3d.addColorset unavailable — DSN not ready?");
    return;
  }

  const existing = dice3d.exports?.COLORSETS ?? null;
  let added = 0;
  let skipped = 0;
  for (const cs of PF2E_COLORSETS) {
    if (existing && existing[cs.name]) {
      // Some other module beat us to it (or DSN added it in a future
      // version). Don't overwrite the user's effective choice.
      skipped++;
      continue;
    }
    try {
      dice3d.addColorset({ ...cs, category: DSN_DAMAGE_TYPE_CATEGORY });
      added++;
    } catch (e) {
      warn(`pf2e-colorsets: failed to register ${cs.name}`, e);
    }
  }
  registered = true;
  log(`pf2e-colorsets: registered ${added}/${PF2E_COLORSETS.length} (${skipped} pre-existing)`);
}
