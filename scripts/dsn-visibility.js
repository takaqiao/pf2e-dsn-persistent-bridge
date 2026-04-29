import { log, warn } from "./constants.js";

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
 */

let installed = false;

export function getDsnVisibility() {
  return game?.dice3d?.persistentDiceVisibility ?? "all";
}

export function installVisibilityPatch() {
  if (installed) return;
  const pdm = game?.dice3d?.box?.persistentDiceManager;
  if (!pdm || typeof pdm._applyPersistentDieVisibility !== "function") {
    warn("visibility patch: persistentDiceManager not ready, skipping");
    return;
  }
  const orig = pdm._applyPersistentDieVisibility.bind(pdm);
  pdm._applyPersistentDieVisibility = function (mesh) {
    if (mesh?.userData?.dsnPF2eBridge_forceVisible === true) {
      const parent = mesh.parent;
      if (parent) parent.visible = true;
      return;
    }
    return orig(mesh);
  };
  installed = true;
  log("visibility patch installed");
}
