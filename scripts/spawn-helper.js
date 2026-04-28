import { SETTINGS, getSetting, log, warn } from "./constants.js";
import { SlotRegistry } from "./slot-store.js";
import {
  emitLockEvent,
  emitSecretMirror,
  emitSecretMirrorCleanup,
  emitSecretDisplay,
  emitSecretDisplayCleanup,
} from "./socket.js";

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

  // All secret modes spawn locally on the dialog opener's client; we never
  // sync via socket because other clients shouldn't see the throw at all
  // (that animation is the leak vector we close here).
  //
  // Whether the opener sees a real die or a ghost depends on whether they
  // can read the chat result for this roll mode:
  //
  //   GM Roll    : PF2e hides chat from everyone except the GM. So a player
  //                opener cannot see the result → ghost. GM opener sees
  //                chat → real die feeds PF2e.
  //   Blind Roll : same as GM Roll — chat hidden from all but the GM.
  //                Player opener → ghost; GM opener → real.
  //   Self Roll  : chat is visible only to the roller, who *is* the opener.
  //                Either GM or player as opener can read chat → real die.
  //
  // Ghost meshes are not tagged `dsnPF2eBridge_owned`, so the listener
  // ignores their value and PF2e ends up using its own RNG — the player
  // physically cannot back-derive the actual roll result.
  const isGM = !!game.user?.isGM;
  const openerSeesChat =
    norm === "self"            // self → opener (=roller) sees chat
    || (isGM && (norm === "gm" || norm === "blind"));  // GM opener → GM sees chat
  const ceremonial = !openerSeesChat;

  if (norm === "gm" || norm === "blind" || norm === "self") {
    return {
      secret: true,
      mode: norm,
      shouldSpawn: true,
      shouldSync: false,
      ceremonial,
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
/**
 * Remove a task die from DSN's persistent-dice flag so refresh doesn't
 * resurrect it. DSN normally writes every spawned die owned by the current
 * user into `user.flags["dice-so-nice"].persistentDice` for restoration on
 * reload. Task dice are session-only by design — a refresh while a dialog
 * is open should not leave the canvas littered with orphaned task meshes.
 *
 * Touches DSN's private `_persistentDiceData` Map (the in-memory source
 * of truth that gets serialized to the flag). After we delete the entry
 * we trigger a re-save so the flag stops listing this die.
 */
function stripFromDsnPersistFlag(persistentId) {
  try {
    const dice3d = game.dice3d;
    if (!dice3d || !persistentId) return;
    dice3d._persistentDiceData?.delete?.(persistentId);
    // Re-save the (now smaller) map back to the user flag.
    if (typeof dice3d._savePersistentDiceToFlags === "function") {
      dice3d._savePersistentDiceToFlags();
    }
  } catch (e) {
    warn("stripFromDsnPersistFlag failed", e);
  }
}

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
    store._secret = true;
    if (secrecy.ceremonial) {
      log(`autoSpawn: blind roll opener (${secrecy.mode}); ghost local + sync, hidden values`);
      store._ceremonial = true;
      store._hideValues = true;
    } else {
      log(`autoSpawn: secret roll opener (${secrecy.mode}); real die, local-only`);
    }
  }
  // Sync policy: every secret mode is local-only (synchronize=false). DSN
  // does NOT broadcast the spawn; we instead emit our own `secret-mirror`
  // message so each receiver can independently spawn a local mesh whose
  // appearance matches their viewer role (ghost vs real) — see decideViewer
  // in socket.js. The `persistentId` is preserved across all clients, so
  // DSN's own throw-socket (independent of spawn sync) automatically replays
  // the physics on every mirror mesh — GM sees a real-die throw animation,
  // other players see a ghost throw animation, opener stays in their own
  // local rendering.
  const synchronize = !secrecy.secret;

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
      // Secret-roll cross-client policy: a single, uniform mirror path.
      //
      // The opener's spawn is local (sync=false). emitSecretMirror tells
      // every other client to spawn its own mirror mesh with the same
      // persistentId. Each receiver independently picks ghost or real
      // appearance via decideViewerVisibility:
      //
      //   Self Roll  → all non-opener clients (incl. GM) → ghost
      //   GM Roll    → GM → real, other players → ghost
      //   Blind Roll → GM → real, other players (incl. opener-PL's
      //                peers) → ghost. Opener's own client renders
      //                ghost locally via opts.appearance (handled below
      //                in the ceremonial branch).
      //
      // Because all mirror mesh share the opener's persistentId, DSN's
      // own throw socket (independent of spawn-sync) automatically
      // replays the physics across every client when the opener throws.
      // So every viewer sees a moving die — real for those allowed to
      // see the value, ghost for those who shouldn't.
      if (secrecy.secret) {
        emitSecretMirror({
          mode: secrecy.mode,
          dieType,
          position: pos,
          persistentId: mesh.userData.persistentId,
          openerUserId: game.user.id,
        });
      }
      // Strip this task die from DSN's per-user "persistentDice" flag so a
      // browser refresh while the dialog is open doesn't leave an orphan
      // mesh on the canvas. Without this, DSN re-spawns it on every reload
      // because it thinks the user wanted a permanent decorative die there.
      stripFromDsnPersistFlag(mesh.userData.persistentId);
      mesh.userData.dsnPF2eBridge_dialogId = store.dialogId;
      // Always tag as owned now: the listener consumes the value and the
      // wrapper injects it into PF2e's Roll, ensuring the mesh face the
      // GM sees is the same value PF2e ends up using. For ceremonial
      // dice, the slot value will be marked `hidden` so the player's
      // tray doesn't display it.
      mesh.userData.dsnPF2eBridge_owned = true;
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

  // Removal sync semantics:
  //   public (sync=true on spawn) → DSN sync the remove (broadcast=true)
  //   secret (sync=false on spawn) → local remove only; we tell receivers
  //     via secret-mirror-cleanup so they tear down their own mirror meshes.
  const wasSecret = store?._secret === true;
  for (const id of ids) {
    try { dice3d.removePersistentDie(id, !wasSecret); } catch {}
  }
  if (wasSecret) {
    emitSecretMirrorCleanup(ids);
  }
  store._spawnedMeshIds = [];
  log(`autoSpawn: cleaned up ${ids.length} task dice for dialog ${store.dialogId} (secret=${wasSecret})`);
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
