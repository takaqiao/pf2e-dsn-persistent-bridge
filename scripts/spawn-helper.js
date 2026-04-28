import { SETTINGS, getSetting, log, warn } from "./constants.js";
import { SlotRegistry } from "./slot-store.js";
import { emitLockEvent } from "./socket.js";

/**
 * Decide how this dialog's roll mode affects task-dice spawning.
 *
 * Returns one of:
 *   { secret: false }                                 — public, normal flow
 *   { secret: true, mode, shouldSpawn, shouldSync }   — secret roll, behave per below
 *
 * Modes:
 *   publicroll: not secret. spawn + broadcast to everyone.
 *   gmroll:     GM-only chat; dice should only render on the GM's screen.
 *               GM client → spawn locally (synchronize=false).
 *               Player client → don't spawn (they shouldn't see the dice land).
 *   blindroll:  GM sees chat, EVERYONE ELSE blind (including roll initiator).
 *               GM client → spawn locally.
 *               Anyone else → don't spawn.
 *   selfroll:   only the initiator sees chat.
 *               Initiator → spawn locally (sync=false).
 *               Others → don't spawn.
 */
/**
 * Normalize a Foundry roll-mode string. Foundry has used several spellings
 * across versions:
 *   v10/v11: "roll" / "gmroll" / "blindroll" / "selfroll"
 *   v13/v14: PF2e dialog <select> emits "public" / "gm" / "blind" / "self"
 *            (Foundry changed CONFIG.ChatMessage.modes value strings).
 * We collapse both forms to the short stem so comparisons stay simple.
 */
function normalizeMode(mode) {
  const m = String(mode ?? "").toLowerCase().trim();
  if (!m) return "";
  // strip a trailing "roll" if present: "blindroll" → "blind"
  return m.endsWith("roll") ? m.slice(0, -4) : m;
}

export function classifyRollSecrecy(dialog) {
  if (getSetting(SETTINGS.respectSecretRolls) === false) {
    return { secret: false };
  }

  const norm = normalizeMode(getDialogMessageMode(dialog));
  // "" (none/unknown) and "public" are non-secret.
  if (!norm || norm === "public") {
    return { secret: false };
  }

  // Any secret mode (gm / blind / self) gets the same treatment: spawn a
  // CEREMONIAL ghost die only on the dialog opener's client. Every face
  // renders as "?", so even the GM (when GM is the opener of a GM Roll)
  // can't read the value off the mesh. PF2e's evaluate runs against pure
  // RNG because ceremonial dice don't carry the `dsnPF2eBridge_owned` flag,
  // so the listener never feeds their values into the slot pipeline.
  // The actual result is communicated via the chat message PF2e produces
  // — and PF2e's own roll-mode handling already controls who sees that.
  //
  // Other clients (not the opener) get no spawn at all: they shouldn't see
  // the dice land at all, since that animation is the leak vector we're
  // closing here.
  if (norm === "gm" || norm === "blind" || norm === "self") {
    return {
      secret: true,
      mode: norm,
      shouldSpawn: true,
      shouldSync: false,
      ceremonial: true,
    };
  }

  // Unknown mode: be safe, treat as public.
  return { secret: false };
}

/**
 * Build a ghost-appearance descriptor — same as the user's normal dice but
 * with `isGhost: true`, which DSN's DiceFactory honors by replacing every
 * face label with "?" in the rendered material.
 */
function buildGhostAppearance(dieType) {
  try {
    const Dice3DCls = game.dice3d?.constructor;
    const factory = game.dice3d?.DiceFactory;
    if (!Dice3DCls?.APPEARANCE || !factory?.getAppearanceForDice) return null;
    const raw = Dice3DCls.APPEARANCE(game.user);
    const base = factory.getAppearanceForDice(raw, dieType);
    return { ...base, isGhost: true };
  } catch (e) {
    warn("buildGhostAppearance failed", e);
    return null;
  }
}

function getDialogMessageMode(dialog) {
  // 1) Most authoritative: read the live <select> value in the dialog DOM.
  //    PF2e dialog template puts `<select name="messageMode">` directly in
  //    the form. This reflects whatever the user has currently dialed in,
  //    including a fresh change they made before submit.
  try {
    const root = dialog?.element?.[0] ?? dialog?.element;
    const select = root?.querySelector?.('select[name="messageMode"]');
    if (select?.value) return select.value;
  } catch {}

  // 2) Fallback: dialog.context.messageMode (snapshot at construction time).
  if (dialog?.context?.messageMode) return dialog.context.messageMode;

  // 3) Final fallback: user's default rollMode (Foundry standard) — try a
  //    few candidate keys since PF2e/Foundry have used both names.
  for (const key of ["rollMode", "messageMode"]) {
    try {
      const v = game?.settings?.get?.("core", key);
      if (v) return v;
    } catch {}
  }
  return "publicroll";
}

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

  // Honor secret rolls: skip spawning entirely on clients that shouldn't see
  // the result, and never broadcast across socket when we do spawn.
  const secrecy = classifyRollSecrecy(store.dialog);
  log("autoSpawn: classified roll secrecy", {
    detectedMode: getDialogMessageMode(store.dialog),
    classification: secrecy,
    isGM: !!game.user?.isGM,
  });
  if (secrecy.secret) {
    if (!secrecy.shouldSpawn) {
      log(`autoSpawn: secret roll (${secrecy.mode}); skipping spawn on this client`);
      store._secret = true;
      return [];
    }
    if (secrecy.ceremonial) {
      log(`autoSpawn: ceremonial ghost roll (${secrecy.mode}); spawning blind dice that never feed PF2e`);
      store._secret = true;
      store._ceremonial = true;
    } else {
      log(`autoSpawn: secret roll (${secrecy.mode}); spawning locally only (no socket sync)`);
      store._secret = true;
    }
  }
  const synchronize = secrecy.secret ? !!secrecy.shouldSync : true;

  const positions = layoutPositions(slots.length);
  const spawnedIds = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const dieType = `d${slot.faces}`;
    const pos = positions[i];
    try {
      const spawnOpts = { ownerUserId: game.user.id };
      if (secrecy.ceremonial) {
        const ghost = buildGhostAppearance(dieType);
        if (ghost) {
          spawnOpts.appearance = ghost;
          log("autoSpawn: ghost appearance attached", { dieType, isGhost: ghost.isGhost });
        } else {
          warn(`autoSpawn: ghost appearance build failed for ${dieType} — falling back to normal die (player may see real value!)`);
        }
      }
      const mesh = await dice3d.spawnPersistentDie(dieType, pos, spawnOpts, synchronize);
      if (!mesh) {
        warn(`autoSpawn: spawnPersistentDie returned null for ${dieType}`);
        continue;
      }
      mesh.userData.dsnPF2eBridge_dialogId = store.dialogId;
      // Ceremonial ghost dice are intentionally NOT tagged as owned. The
      // listener's owned-only gate then ignores any value they produce, so
      // PF2e's evaluate runs against pure RNG and the player's ritual throw
      // can't leak the actual blindroll result.
      if (!secrecy.ceremonial) {
        mesh.userData.dsnPF2eBridge_owned = true;
      } else {
        mesh.userData.dsnPF2eBridge_ceremonial = true;
      }
      // Lock to the dialog opener by default. DSN's InputHandler honors
      // `userData.lockedBy`: any other player's drag / Ctrl-click attempts
      // are rejected. The user can manually unlock the whole tray via the
      // tray UI's lock toggle.
      //
      // Secret rolls (incl. ceremonial ghosts): skip lock broadcast — the
      // mesh is only on this client (synchronize=false), so other clients
      // have nothing to lock. Local lock is still set so the tray's
      // "lock toggle" UI stays consistent.
      if (getSetting(SETTINGS.taskDiceLockedByDefault) !== false) {
        mesh.userData.lockedBy = game.user.id;
        if (!secrecy.secret) {
          emitLockEvent(mesh.userData.persistentId, game.user.id);
        }
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
