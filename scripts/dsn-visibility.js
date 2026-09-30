import { log } from "./constants.js";

/**
 * DSN's persistent-dice visibility filter has three modes:
 *   "all"  — show everyone's persistent dice
 *   "mine" — only show my own dice; others' dice exist in the scene but
 *            their parent.visible is forced to false
 *   "none" — hide every persistent die regardless of owner
 *
 * The filter is purely visual — meshes still tick physics each frame even
 * when hidden. So a user in "none" mode who accumulates dice still pays
 * full CPU cost for every accumulated mesh.
 *
 * Our bridge's task dice need to be throwable on the opener's client even
 * when DSN visibility=none. We patch DSN's per-die visibility application
 * to skip meshes we've tagged force-visible. The patch is local; only the
 * opener tags their meshes, so other clients' filters work normally.
 *
 * The patch goes on the PROTOTYPE (not the live instance) with a sentinel,
 * for the same reason as the InputHandler patches: DSN's `resizeAndRebuild`
 * (window resize, perf-preset change) calls `_buildDiceBox()` which builds a
 * fresh `new PersistentDiceManager(...)`. An instance patch is lost on every
 * rebuild; a prototype patch is inherited by all current and future managers.
 * We also defer to `diceSoNiceReady` when the manager isn't constructed yet,
 * matching the right-click / shake / restrict-spawn installers — at our own
 * `ready` time DSN hasn't built its box/manager yet, so an eager install
 * would otherwise silently no-op forever.
 */

let installed = false;

export function getDsnVisibility() {
  // The getter is on DiceBox, NOT on Dice3D. `game.dice3d.persistentDiceVisibility`
  // returns undefined; the correct path is `game.dice3d.box.persistentDiceVisibility`,
  // which delegates to `persistentDiceManager.persistentDiceVisibility`.
  return game?.dice3d?.box?.persistentDiceVisibility ?? "all";
}

export function installVisibilityPatch() {
  if (installed) return;
  const pdm = game?.dice3d?.box?.persistentDiceManager;
  if (!pdm || typeof pdm._applyPersistentDieVisibility !== "function") {
    // Manager not built yet — defer to DSN's ready signal and retry, exactly
    // like the other DSN patches. Without this the patch never installs on a
    // normal load (DSN builds its box asynchronously after our ready hook).
    log("visibility patch: persistentDiceManager not ready, deferring to diceSoNiceReady");
    Hooks.once("diceSoNiceReady", () => installVisibilityPatch());
    return;
  }
  const proto = Object.getPrototypeOf(pdm);
  if (!proto || proto._dsnBridgeVisibilityPatched) {
    installed = true;
    return;
  }
  proto._dsnBridgeVisibilityPatched = true;
  const orig = proto._applyPersistentDieVisibility;
  proto._applyPersistentDieVisibility = function (mesh) {
    if (mesh?.userData?.dsnPF2eBridge_forceVisible === true) {
      const parent = mesh.parent;
      if (parent) parent.visible = true;
      return;
    }
    return orig.call(this, mesh);
  };
  installed = true;
  log("visibility patch installed (prototype-patched, survives box rebuilds)");
}
