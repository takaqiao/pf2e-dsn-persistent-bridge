import { MOD_ID, SETTINGS, getSetting, log, tagged } from "./constants.js";

/**
 * Block players from spawning their own DSN persistent dice via DSN's
 * toolbox UI / API. Only the bridge module's task-die spawns are exempt
 * (they pass the `_dsnBridgeAllowed: true` marker on the opts argument).
 *
 * Why this exists: DSN's `Dice3D.spawnPersistentDie` is callable by anyone
 * with permissions to interact with the canvas. The toolbox UI's `_spawn`
 * method only GM-gates `_clearAll`, not creation. Players accumulate
 * decorative persistent dice across sessions; DSN restores them on every
 * login — clutter that the GM has no easy way to police. This setting
 * gives the GM a single switch.
 *
 * Implementation: prototype-patch `Dice3D.prototype.spawnPersistentDie`.
 * GM is always allowed; bridge-marked spawns are always allowed; everyone
 * else is rejected with a localized warn-toast and a console line.
 *
 * Note: this only blocks NEW spawns. Existing decorative dice from before
 * the setting was turned on aren't auto-removed — DSN would re-restore
 * them on next login. Clear them via DSN's toolbox "Clear all" once.
 */

const TAG = "[PF2e×DSN restrict-spawn]";
const diag = tagged(TAG);

let installed = false;

export function installRestrictPersistentSpawn() {
  if (installed) return;
  const dice3d = game?.dice3d;
  if (!dice3d?.spawnPersistentDie) {
    diag("install deferred — Dice3D not ready, waiting for diceSoNiceReady");
    Hooks.once("diceSoNiceReady", () => installRestrictPersistentSpawn());
    return;
  }
  patch(Object.getPrototypeOf(dice3d));
  installed = true;
}

function patch(proto) {
  if (!proto || proto._dsnBridgeRestrictPatched) {
    diag("patch skipped — already patched on this prototype");
    return;
  }
  proto._dsnBridgeRestrictPatched = true;

  const orig = proto.spawnPersistentDie;
  proto.spawnPersistentDie = async function (dieType, position, opts = {}, synchronize = true) {
    const restricted = getSetting(SETTINGS.restrictPlayerPersistentDice) !== false;
    const isGM = !!game.user?.isGM;
    const bridgeAllowed = opts && opts._dsnBridgeAllowed === true;
    if (restricted && !isGM && !bridgeAllowed) {
      // Always print this — it's a refusal that affects user-visible behavior;
      // a player wondering "why didn't my die appear?" needs to find this in
      // console regardless of whether verboseLogging is on.
      console.warn(TAG,
        `blocked spawn (dieType=${dieType}, user=${game.user?.name}) — players cannot spawn persistent dice`);
      ui.notifications?.warn(
        game.i18n.localize(`${MOD_ID}.restrictSpawn.blocked`)
      );
      return null;
    }
    return orig.call(this, dieType, position, opts, synchronize);
  };
  log("restrict-persistent-spawn: installed (prototype-patched)");
}
