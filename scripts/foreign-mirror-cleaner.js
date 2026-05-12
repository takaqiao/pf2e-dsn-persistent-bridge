import { log } from "./constants.js";

/**
 * Receiver-side optimization for DSN visibility = "mine" / "none".
 *
 * Empirical fact: DSN's `_applyPersistentDieVisibility` sets a foreign
 * die's `parent.visible = false` at spawn and never re-enables it —
 * not even during throw replay. So in "mine" / "none" mode, a foreign
 * task die is invisible from spawn to removal: the throw animation, the
 * settle, the rest pose, all of it. Keeping the mesh in
 * `persistentDiceList` therefore buys the user nothing visually but
 * costs a hidden physics tick per frame.
 *
 * What this does: hook `dice-so-nice.persistentDiceChanged` (which
 * fires on every add). Any newly-added persistent die that's tagged as
 * one of our task dice and is not owned by us gets a microtask-deferred
 * local removal (broadcast=false). Net cost on the canvas: zero.
 *
 * Earlier 0.2.3 version polled at 4 Hz and removed on settle; that left
 * the mesh ticking through the entire throw, which is wasted work since
 * the user never sees it anyway.
 *
 * Local removal only — opener's own cleanup at dialog close still
 * broadcasts the canonical removal; DSN's removePersistentDie no-ops
 * if the die was already removed locally.
 */

// Map<persistentId, expiry-timestamp> instead of Set+per-entry setTimeout.
// Pruned by a single interval started in `startForeignMirrorCleaner`.
const removedRecently = new Map();
const REMEMBER_MS = 5000;

function isHiddenViewer() {
  // Getter is on DiceBox, not Dice3D — `game.dice3d.persistentDiceVisibility`
  // is undefined.
  const v = game?.dice3d?.box?.persistentDiceVisibility;
  return v === "mine" || v === "none";
}

function sweepForeignTaskDice() {
  if (!isHiddenViewer()) return 0;
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return 0;
  const myId = game.user?.id;
  let n = 0;
  for (const mesh of list) {
    if (mesh?.userData?.dsnPF2eBridge_owned !== true) continue;
    if (mesh.userData.ownerUserId === myId) continue;
    const id = mesh.userData.persistentId;
    if (!id || removedRecently.has(id)) continue;
    removedRecently.set(id, Date.now() + REMEMBER_MS);
    queueMicrotask(() => {
      try { game.dice3d.removePersistentDie(id, false); } catch {}
    });
    n++;
  }
  if (n) log(`hidden-viewer: skipped ${n} foreign task die(s)`);
  return n;
}

export function startForeignMirrorCleaner() {
  Hooks.on("dice-so-nice.persistentDiceChanged", sweepForeignTaskDice);
  // Also sweep once at startup — handles the case where DSN restored a
  // foreign task die from a prior session (rare; opener-side restore
  // suppression should prevent this, but defensive).
  try { sweepForeignTaskDice(); } catch {}
  // Centralized prune for `removedRecently` — single interval instead of
  // per-entry setTimeout. Same pattern as socket.js's pruneSocketCaches.
  setInterval(() => {
    const now = Date.now();
    for (const [id, expiry] of removedRecently) {
      if (expiry <= now) removedRecently.delete(id);
    }
  }, 2000);
  log("hidden-viewer skip-on-receive registered");
}
