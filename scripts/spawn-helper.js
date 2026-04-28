import { SETTINGS, getSetting, log, warn } from "./constants.js";
import { SlotRegistry } from "./slot-store.js";
import { emitLockEvent } from "./socket.js";

/**
 * Spawn task dice for a roll dialog and tag them so the listener distinguishes
 * them from user-spawned "decorative" persistent dice.
 *
 * Each spawned mesh gets:
 *   userData.dsnPF2eBridge_owned    = true       // listener gate
 *   userData.dsnPF2eBridge_dialogId = appId      // for cleanup on close
 */

export async function spawnTaskDiceForStore(store) {
  if (getSetting(SETTINGS.autoSpawnDice) === false) return [];
  const dice3d = game.dice3d;
  if (!dice3d) {
    warn("autoSpawn: game.dice3d not ready");
    return [];
  }
  const slots = store.slots ?? [];
  if (slots.length === 0) return [];

  // Don't double-spawn if this store already has spawned dice attached.
  if (store._spawnedMeshIds?.length > 0) return store._spawnedMeshIds;

  const positions = layoutPositions(slots.length);
  const spawnedIds = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const dieType = `d${slot.faces}`;
    const pos = positions[i];
    try {
      const mesh = await dice3d.spawnPersistentDie(dieType, pos, {
        ownerUserId: game.user.id,
      }, true);
      if (!mesh) {
        warn(`autoSpawn: spawnPersistentDie returned null for ${dieType}`);
        continue;
      }
      // Tag as our task die. These are the only ones the listener will accept.
      mesh.userData.dsnPF2eBridge_owned = true;
      mesh.userData.dsnPF2eBridge_dialogId = store.dialogId;
      // Lock to the dialog opener by default. DSN's InputHandler honors
      // `userData.lockedBy`: any other player's drag / Ctrl-click attempts
      // are rejected. The user can manually unlock the whole tray via the
      // tray UI's lock toggle.
      //
      // We must broadcast the lock to other clients via socket because DSN's
      // own spawn-sync does NOT include `lockedBy` in its payload — without
      // the broadcast other clients would see the mesh as unlocked.
      if (getSetting(SETTINGS.taskDiceLockedByDefault) !== false) {
        mesh.userData.lockedBy = game.user.id;
        emitLockEvent(mesh.userData.persistentId, game.user.id);
      }
      spawnedIds.push(mesh.userData.persistentId);
    } catch (e) {
      warn(`autoSpawn: failed to spawn ${dieType}`, e);
    }
  }

  store._spawnedMeshIds = spawnedIds;
  log(`autoSpawn: created ${spawnedIds.length} task dice for dialog ${store.dialogId}`);

  // After spawn, re-raise the DSN canvas above the just-opened PF2e dialog.
  // DSN's spawnPersistentDie internally calls `_beforeShow()` which raises
  // the canvas, but PF2e's ApplicationV2 dialog mounts AFTER that and bumps
  // ApplicationV2._maxZ, leaving the canvas underneath. We re-raise here.
  raiseDsnCanvasAboveAll();
  return spawnedIds;
}

/**
 * Force the DSN canvas above all current Foundry UI by setting an explicit
 * z-index higher than the global ApplicationV2 max. We don't go absurdly
 * high because the PF2e roll dialog itself must remain interactable.
 *
 * Strategy: pick (currentMaxZ - 1) so we sit just below the topmost dialog
 * (which is always the PF2e roll dialog the user is interacting with),
 * but above chat / sidebar / scene controls.
 */
export function raiseDsnCanvasAboveAll() {
  try {
    const dice3d = game.dice3d;
    const canvasEl = dice3d?.canvas?.[0] ?? dice3d?.canvas;
    if (!canvasEl) return;
    const maxZ = foundry?.applications?.api?.ApplicationV2?._maxZ;
    if (Number.isFinite(maxZ)) {
      // sit just below the topmost AppV2 (the active dialog) but above
      // chat / sidebar / non-AppV2 elements that live around z 100~200
      canvasEl.style.zIndex = String(Math.max(150, maxZ - 1));
    } else {
      canvasEl.style.zIndex = "950"; // generic safe fallback
    }
  } catch {}
}

/**
 * Toggle the lock on this dialog's task dice. When locked, only the dialog
 * owner can drag/throw them (DSN's InputHandler enforces userData.lockedBy).
 * When unlocked, anyone at the table can interact.
 *
 * Returns the new locked state (true = locked).
 */
export function toggleTaskDiceLock(store) {
  const ids = new Set(store?._spawnedMeshIds ?? []);
  if (ids.size === 0) return null;
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return null;

  // Determine current state from the first matching mesh, then flip on all.
  let currentlyLocked = false;
  for (const mesh of list) {
    if (!ids.has(mesh?.userData?.persistentId)) continue;
    if (mesh.userData?.lockedBy === game.user.id) {
      currentlyLocked = true;
      break;
    }
  }
  const newState = !currentlyLocked;

  for (const mesh of list) {
    if (!ids.has(mesh?.userData?.persistentId)) continue;
    if (!mesh.userData) continue;
    if (newState) mesh.userData.lockedBy = game.user.id;
    else delete mesh.userData.lockedBy;
    // Broadcast to all other clients so their local mesh.userData.lockedBy
    // matches and their InputHandler enforces (or releases) the same gate.
    emitLockEvent(mesh.userData.persistentId, newState ? game.user.id : null);
  }

  store._unlocked = !newState;
  log(`task dice for dialog ${store.dialogId}: ${newState ? "locked" : "unlocked"}`);
  return newState;
}

export function cleanupTaskDiceForStore(store) {
  const ids = store?._spawnedMeshIds ?? [];
  if (ids.length === 0) return;
  const dice3d = game.dice3d;
  if (!dice3d) return;
  for (const id of ids) {
    try { dice3d.removePersistentDie(id, true); } catch {}
  }
  store._spawnedMeshIds = [];
  log(`autoSpawn: cleaned up ${ids.length} task dice for dialog ${store.dialogId}`);
}

/**
 * Hide all decorative (user-spawned) persistent dice while a roll dialog is
 * open, so the canvas only shows the task dice the user actually needs to
 * throw. Stash original visibility on the mesh so we can restore exactly.
 */
export function hideDecorativeDice() {
  if (getSetting(SETTINGS.hideDecorativeDuringDialog) === false) return;
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return;
  let count = 0;
  for (const mesh of list) {
    if (!mesh || mesh.userData?.dsnPF2eBridge_owned === true) continue;
    if (mesh.userData?.dsnPF2eBridge_hidden === true) continue; // already hidden by another dialog
    // Stash on both mesh and its parent group, since DSN wraps each die
    // in an objectContainer Group added to the scene.
    const targets = collectVisibilityTargets(mesh);
    mesh.userData ??= {};
    mesh.userData.dsnPF2eBridge_hidden = true;
    mesh.userData.dsnPF2eBridge_priorVis = targets.map((t) => t.visible);
    for (const t of targets) t.visible = false;
    count++;
  }
  if (count > 0) log(`hideDecorative: hid ${count} decorative dice`);
}

/**
 * Restore decorative dice when the last open dialog closes. If any other
 * dialog store remains, keep hidden — the next dialog's user is still rolling.
 */
export function restoreDecorativeDiceIfNoActiveDialogs() {
  if (SlotRegistry.all().length > 0) return; // another dialog still active
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return;
  let count = 0;
  for (const mesh of list) {
    if (!mesh || mesh.userData?.dsnPF2eBridge_hidden !== true) continue;
    const prior = mesh.userData?.dsnPF2eBridge_priorVis;
    const targets = collectVisibilityTargets(mesh);
    if (Array.isArray(prior) && prior.length === targets.length) {
      for (let i = 0; i < targets.length; i++) targets[i].visible = prior[i];
    } else {
      for (const t of targets) t.visible = true;
    }
    delete mesh.userData.dsnPF2eBridge_hidden;
    delete mesh.userData.dsnPF2eBridge_priorVis;
    count++;
  }
  if (count > 0) log(`restoreDecorative: restored ${count} decorative dice`);
}

function collectVisibilityTargets(mesh) {
  const targets = [mesh];
  if (mesh.parent && mesh.parent !== mesh) targets.push(mesh.parent);
  return targets;
}

/**
 * Layout positions in canvas-percent coords {x, y} ∈ [0,1].
 * Goal: visible, not overlapping, biased to the lower-center where the user
 * naturally drags from.
 */
function layoutPositions(count) {
  // Spawn dice on the LEFT side of the canvas, mid-height. This keeps them:
  //  - away from the chat sidebar (right edge)
  //  - away from the PF2e roll dialog (typically centered)
  //  - in a place where a quick mouse drag has plenty of room to gain velocity
  // Stacked vertically so multi-dice damage rolls don't sprawl horizontally.
  const COL_X = 0.18;
  if (count <= 0) return [];
  if (count === 1) return [{ x: COL_X, y: 0.5 }];
  // Vertical column, evenly spaced around mid-height
  const spacing = 0.08;
  const startY = 0.5 - ((count - 1) / 2) * spacing;
  return Array.from({ length: count }, (_, i) => ({
    x: COL_X,
    y: startY + i * spacing,
  }));
}
