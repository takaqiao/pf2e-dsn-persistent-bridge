import { SETTINGS, getSetting, log, tagged, warn } from "./constants.js";

const visibilityDiag = tagged("[PF2e×DSN visibility]");
import { SlotRegistry } from "./slot-store.js";
import { getDsnVisibility } from "./dsn-visibility.js";
import { inferShowBreakdownFromDialog } from "./show-breakdown.js";
import {
  emitLockEvent,
  emitSecretMirror,
  emitSecretMirrorCleanup,
  emitTaskFlavorSync,
  emitTaskMarkSync,
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
 * Spawn a persistent die without ever writing it to DSN's per-user
 * `persistentDice` flag. Task dice are session-only by design; a browser
 * refresh while a dialog is open must NOT leave an orphan on the canvas.
 *
 * Strategy: set DSN's internal `_restoringDice = true` flag for the
 * duration of the spawn. DSN's `_savePersistentDiceToFlags()` short-circuits
 * when that flag is set (it normally guards against writing during restore
 * on page load) — so the spawn never reaches `game.user.setFlag(...)`.
 * Then we also delete the entry from DSN's in-memory `_persistentDiceData`
 * Map so any later save (from an unrelated user-spawned die) doesn't
 * accidentally include our task die.
 *
 * The previous implementation called DSN's setFlag *after* spawn and
 * relied on the second setFlag call to overwrite the first. That's
 * fire-and-forget and races against a fast user refresh — exactly the
 * "orphan after refresh" bug the user reported.
 */
async function spawnPersistentDieEphemeral(dice3d, dieType, position, opts, synchronize) {
  const savedRestoring = dice3d._restoringDice;
  dice3d._restoringDice = true;
  let mesh;
  try {
    // `_dsnBridgeAllowed` opts our task-die spawn past the
    // restrictPlayerPersistentDice gate (see restrict-persistent-spawn.js).
    const bridgeOpts = { ...opts, _dsnBridgeAllowed: true };
    mesh = await dice3d.spawnPersistentDie(dieType, position, bridgeOpts, synchronize);
    // While _restoringDice was true, _savePersistentDiceToFlags returned
    // early — but DSN still added an entry to _persistentDiceData. Remove
    // it so any future save (triggered by an unrelated decorative spawn)
    // doesn't pick it up.
    if (mesh?.userData?.persistentId) {
      dice3d._persistentDiceData?.delete?.(mesh.userData.persistentId);
    }
  } finally {
    dice3d._restoringDice = savedRestoring;
  }
  return mesh;
}

/**
 * Build the appearance object for a task die spawn. Combines two concerns:
 *
 *   • Per-damage-type colorset (DSN 6.0+): when `slot.flavor` is set (a PF2e
 *     damage type like "fire" / "slashing") and the user has DSN's
 *     `enableFlavorColorset` toggle on, pass the flavor as a term-shaped
 *     argument to `getAppearanceForDice` so DSN's `damageTypeMap` lookup
 *     applies the user's configured per-type appearance.
 *   • Ghost flag (ceremonial blind/gm): the player opener of a ceremonial
 *     roll sees "?" on every face. We layer `isGhost: true` on top of the
 *     flavored base so the ghost dice still respect the user's per-type
 *     colorset (just with hidden numbers).
 *
 * Returns null when nothing custom is needed (no flavor + no ghost) so the
 * caller can omit `spawnOpts.appearance` and let DSN's spawnPersistentDie
 * pick its default unconditionally.
 */
function buildSlotAppearance(dieType, flavor, { ghost } = {}) {
  if (!flavor && !ghost) return null;
  try {
    const Dice3DCls = game.dice3d?.constructor;
    const factory = game.dice3d?.DiceFactory;
    if (!Dice3DCls?.APPEARANCE || !factory?.getAppearanceForDice) return null;

    const raw = Dice3DCls.APPEARANCE(game.user);
    const flavorEnabled =
      flavor && game.dice3d?.userConfig?.enableFlavorColorset !== false;
    // Set BOTH `type` (DSN's primary key, what we control) and `flavor`
    // (what PF2e's chat-message rolls actually carry — kept as a
    // belt-and-braces fallback in case some user setup or future DSN
    // version reads only the flavor field).
    const term = flavorEnabled ? { options: { type: flavor, flavor } } : null;
    const base = factory.getAppearanceForDice(raw, dieType, term);

    // CRITICAL: getAppearanceForDice spreads `br[colorset]` into the result
    // when a damage type maps. The colorset object stores its name in `name`,
    // not `colorset`, so the result ends up with `colorset: undefined`. Down-
    // stream `generateMaterialData` uses `appearance.colorset` to re-lookup
    // the colorset for "custom" fallbacks — undefined means it falls back to
    // `br.custom` (= user's customized default), which then bleeds into the
    // material. Symptom: persistent task die spawns with user's default
    // appearance instead of the flavored colorset, even though `getAppearance
    // ForDice`'s direct return values (foreground/background/texture) are
    // correct. Fix: write the colorset name back onto the result.
    if (base && flavor && flavorEnabled && !base.colorset) {
      base.colorset = base.name ?? flavor;
    }

    return ghost ? { ...base, isGhost: true } : base;
  } catch (e) {
    warn("buildSlotAppearance failed", e);
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

  // Spawn token — bumped by cleanupTaskDiceForStore() and any concurrent
  // re-entry of spawnTaskDiceForStore() (e.g. dialog re-renders with
  // changed slot shape). Each iteration of the spawn loop checks that
  // its captured token still matches; mismatched tokens abort the loop
  // so meshes don't leak onto a closed/reshaped dialog.
  //
  // Why this matters for *check* rolls: a player can open a check dialog
  // and click Roll within ~50ms — well before our async spawn completes.
  // Without this token, the close-time cleanup runs against an empty
  // `_spawnedMeshIds` and the mesh appears on canvas after the dialog is
  // gone, becoming an orphan that survives until the next dialog open
  // (or page refresh) sweeps it.
  const myToken = (store._spawnToken = (store._spawnToken ?? 0) + 1);

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
  // Sync policy:
  //   secret rolls         — local-only (custom secret-mirror flow).
  //   showBreakdown=false  — local-only too. PF2e flagged this roll as
  //     "players can see chat but not modifiers"; if we let DSN broadcast
  //     the persistent throw, all-mode receivers would render the actual
  //     die face value, leaking the result. Instead we mirror via the
  //     ephemeral-mirror flow which renders ghost ("?") for non-GMs.
  //   otherwise (public + breakdown visible) — broadcast normally.
  //
  // Visibility ("Hide all" / "Show only mine") is a *client-local view
  // filter* and does NOT affect broadcast. Receiver-side optimizations
  // (foreign-mirror-cleaner skip-on-receive + ephemeral mirror) handle
  // the hidden-viewer cost on the receiving end.
  //
  // The opener-side `_forceVisible` flag is independent of broadcast: when
  // the opener's own visibility is "Hide all", DSN's local filter would
  // hide their own task dice too — making them un-throwable. We tag
  // task dice on the opener's client with `dsnPF2eBridge_forceVisible`
  // and patch DSN's per-die visibility application to keep them visible
  // for the opener only (see dsn-visibility.js).
  const visibility = getDsnVisibility();
  const visibilityHidesAll = visibility === "none";
  const showBreakdown = inferShowBreakdownFromDialog(store.dialog);
  const breakdownHidden = showBreakdown === false;
  const synchronize = !secrecy.secret && !breakdownHidden;
  store._localOnly = !synchronize;
  store._forceVisible = visibilityHidesAll && !secrecy.secret;
  // Visibility-decision log — gated by verboseLogging like the rest of the
  // module. Flip the setting on if you need to debug "why did NPC X show
  // as ghost (or not)?" — grep `[PF2e×DSN visibility]` in the console.
  const sourceActor = store.dialog?.context?.self?.actor ?? store.dialog?.context?.actor;
  visibilityDiag(
    `actor=${sourceActor?.name ?? "?"}`,
    `type=${sourceActor?.type ?? "?"}`,
    `alliance=${sourceActor?.alliance ?? "(unset)"}`,
    `hasPlayerOwner=${!!sourceActor?.hasPlayerOwner}`,
    `→ showBreakdown=${showBreakdown}, broadcast=${synchronize}`);
  if (breakdownHidden) {
    log(`autoSpawn: breakdown hidden — local-only spawn, mirror-only viewing`);
  }

  const positions = layoutPositions(slots.length);
  const spawnedIds = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const dieType = `d${slot.faces}`;
    const pos = positions[i];
    try {
      const spawnOpts = { ownerUserId: game.user.id };
      const appearance = buildSlotAppearance(dieType, slot.flavor, {
        ghost: secrecy.ceremonial,
      });
      if (appearance) {
        spawnOpts.appearance = appearance;
        if (secrecy.ceremonial) {
          log("autoSpawn: ghost appearance attached", {
            dieType, flavor: slot.flavor ?? null, isGhost: !!appearance.isGhost,
          });
        } else if (slot.flavor) {
          log("autoSpawn: flavored appearance attached", { dieType, flavor: slot.flavor });
        }
      } else if (secrecy.ceremonial) {
        warn(`autoSpawn: ghost appearance build failed for ${dieType} — falling back to normal die (player may see real value!)`);
      }
      const mesh = await spawnPersistentDieEphemeral(dice3d, dieType, pos, spawnOpts, synchronize);

      // Race guard: cleanupTaskDiceForStore (or a concurrent re-spawn from
      // a dialog re-render with changed slot shape) bumped _spawnToken
      // while we awaited. Our work is stale — destroy what we just spawned
      // and bail out of the loop. Without this, the mesh would land on the
      // canvas with a dialogId pointing at a closed/reshaped dialog and
      // become an orphan until the next sweep.
      if (store._spawnToken !== myToken) {
        if (mesh?.userData?.persistentId) {
          try { dice3d.removePersistentDie(mesh.userData.persistentId, synchronize); } catch {}
        }
        log(`autoSpawn: aborted (token mismatch) for ${dieType} — dialog closed/reshaped during spawn`);
        return [];
      }
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
          // dialogId lets the receiver tag its mirror with the opener's
          // dialog id so a receiver-side orphan sweep can identify it.
          // (The mirror gets `dsnPF2eBridge_owned + _dialogId + _openerUserId`
          // in `applyMirror`; sweep cleans mirrors whose opener went offline.)
          dialogId: store.dialogId,
          flavor: slot.flavor ?? null,
        });
      } else if (synchronize && slot.flavor) {
        // Public-PC roll path: DSN's own broadcast handles spawning the
        // mesh on every receiver, but the broadcast carries only the
        // opener's RAW user appearance — receivers' meshes end up with
        // the opener's default colorset, not the per-damage-type one.
        // Send a follow-up flavor message so each receiver can swap the
        // material to their own flavored appearance for this damage type.
        emitTaskFlavorSync({
          persistentId: mesh.userData.persistentId,
          flavor: slot.flavor,
        });
      }
      // Public broadcast spawns: DSN's sync doesn't carry our `userData`
      // tags. Without separate marker plumbing, receivers' broadcast-
      // spawned task dice are indistinguishable from regular dice — the
      // orphan sweep (`dsnPF2eBridge_owned !== true`) skips them. If the
      // opener disconnects before broadcasting cleanup, foreign task
      // dice persist forever. Emit a `task-mark` socket so receivers
      // can tag their local mesh; sweep then handles them via the
      // opener-online check (same as secret-mirrors).
      if (synchronize) {
        emitTaskMarkSync({
          persistentId: mesh.userData.persistentId,
          dialogId: store.dialogId,
          openerUserId: game.user.id,
        });
      }
      // (No persistence stripping needed — spawnPersistentDieEphemeral
      // already prevented DSN from writing this die to the user flag.)
      mesh.userData.dsnPF2eBridge_dialogId = store.dialogId;
      // Always tag as owned now: the listener consumes the value and the
      // wrapper injects it into PF2e's Roll, ensuring the mesh face the
      // GM sees is the same value PF2e ends up using. For ceremonial
      // dice, the slot value will be marked `hidden` so the player's
      // tray doesn't display it.
      mesh.userData.dsnPF2eBridge_owned = true;
      // Consistent tag schema with receiver-side (mirror / task-mark)
      // meshes: every bridge-owned mesh carries `_openerUserId` of who
      // initiated the spawn. sweepOrphanTaskDice uses
      // `_openerUserId === game.user.id` as the local-vs-foreign branch
      // determinant; absence of this tag is a defensive bug rather than
      // a correctness signal.
      mesh.userData.dsnPF2eBridge_openerUserId = game.user?.id ?? null;
      // Stash the damage type so the task-mirror-throw flow (hidden-viewer
      // ephemeral animation) can replay this die with the receiver's per-
      // type colorset, even though the persistent mesh was already cleaned.
      if (slot.flavor) mesh.userData.dsnPF2eBridge_flavor = slot.flavor;
      // When DSN visibility=none, force this task die visible despite the
      // global hide-all (other persistent dice on the user's canvas stay
      // hidden). The visibility patch in dsn-visibility.js honors this tag.
      if (store._forceVisible) {
        mesh.userData.dsnPF2eBridge_forceVisible = true;
        if (mesh.parent) mesh.parent.visible = true;
      }
      // Lock to the dialog opener by default. DSN's InputHandler honors
      // `userData.lockedBy`: any other player's drag / Ctrl-click attempts
      // are rejected. The user can manually unlock the whole tray via the
      // tray UI's lock toggle.
      //
      // Local-only spawns (secret rolls, visibility=none): skip lock
      // broadcast — the mesh is only on this client, so other clients
      // have nothing to lock. Local lock is still set so the tray's
      // "lock toggle" UI stays consistent.
      if (getSetting(SETTINGS.taskDiceLockedByDefault) !== false) {
        mesh.userData.lockedBy = game.user.id;
        if (!store._localOnly) {
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

  // Auto-select all freshly-spawned task dice so the user can throw them
  // in one drag instead of Ctrl+clicking each one. Only on the opener's
  // client (mirror meshes on receivers don't get selected).
  if (getSetting(SETTINGS.autoSelectAllOnSpawn) === true) {
    selectAllTaskDice(store);
  }

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
 * Select every task die spawned for this dialog using DSN's native multi-
 * select (the same machinery as Ctrl+click). The user can then throw all
 * of them in one drag-and-flick motion instead of Ctrl+clicking each die
 * individually. Optionally fired automatically right after spawn when the
 * `autoSelectAllOnSpawn` setting is on.
 */
export function selectAllTaskDice(store) {
  const ids = new Set(store?._spawnedMeshIds ?? []);
  if (ids.size === 0) return 0;
  const box = game.dice3d?.box;
  const pdm = box?.persistentDiceManager;
  if (!pdm?.selectedPersistentDiceIds) return 0;

  let added = 0;
  for (const mesh of box.persistentDiceList ?? []) {
    if (!ids.has(mesh?.userData?.persistentId)) continue;
    if (mesh.userData?.dsnPF2eBridge_secretMirror) continue; // mirrors are display-only on receivers
    if (!pdm.selectedPersistentDiceIds.has(mesh.id)) {
      pdm.selectedPersistentDiceIds.add(mesh.id);
      added++;
    }
  }
  if (added > 0 && typeof pdm.onSelectionChanged === "function") {
    pdm.onSelectionChanged();
  }
  log(`select-all: selected ${added} task dice for dialog ${store.dialogId}`);
  return added;
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
  // Invalidate any in-flight spawn for this store. The spawn loop checks
  // _spawnToken after each await; mismatched token aborts the loop and
  // self-cleans the just-spawned mesh, so we don't leak orphans past
  // close on rapid open→submit / open→cancel patterns.
  if (store) store._spawnToken = (store._spawnToken ?? 0) + 1;

  const dice3d = game.dice3d;
  if (!dice3d) {
    if (store) store._spawnedMeshIds = [];
    return;
  }
  const list = dice3d.box?.persistentDiceList;
  if (!Array.isArray(list)) {
    if (store) store._spawnedMeshIds = [];
    return;
  }

  // Search by `dsnPF2eBridge_dialogId` tag rather than relying on the
  // store's `_spawnedMeshIds` array. Why: the spawn loop tags the mesh's
  // dialogId IMMEDIATELY after the spawnPersistentDie await resolves
  // (synchronous, no yield), but only pushes the id into _spawnedMeshIds
  // at the very end of the loop. So a mesh that completed spawn and got
  // tagged but didn't finish the loop yet is invisible to a cleanup that
  // reads _spawnedMeshIds. Walking the live persistentDiceList by tag
  // catches every mesh that's actually on the canvas right now.
  const dialogId = store?.dialogId;
  const ids = [];
  const meshes = [];
  if (dialogId != null) {
    for (const mesh of list) {
      if (mesh?.userData?.dsnPF2eBridge_owned !== true) continue;
      // Skip receiver-side mirrors: they belong to a different opener's
      // dialog and have the opener's appId as dialogId. They're cleaned
      // via `secret-mirror-cleanup` broadcast (handled in socket.js)
      // and `sweepOrphanTaskDice` (opener-offline fallback).
      if (mesh.userData?.dsnPF2eBridge_secretMirror === true) continue;
      if (mesh.userData?.dsnPF2eBridge_dialogId !== dialogId) continue;
      const id = mesh.userData?.persistentId;
      if (id) {
        ids.push(id);
        meshes.push(mesh);
      }
    }
  }

  // If any of our dice are currently held by the local input handler
  // (user picked one up and the dialog is closing under them), force-
  // release them BEFORE removePersistentDie. Otherwise DSN's constraint
  // remains pinned and the mesh can survive removal in an inconsistent
  // physics state.
  const ih = dice3d.box?.inputHandler;
  if (ih?.mouse?.heldPersistentDice?.length > 0 && ids.length > 0) {
    const idSet = new Set(ids);
    const stillHeld = ih.mouse.heldPersistentDice.filter(
      (m) => !idSet.has(m?.userData?.persistentId)
    );
    if (stillHeld.length !== ih.mouse.heldPersistentDice.length) {
      log(`cleanup: force-releasing ${ih.mouse.heldPersistentDice.length - stillHeld.length} held task die(s)`);
      ih.mouse.heldPersistentDice = stillHeld;
      if (stillHeld.length === 0) {
        try {
          ih.mouse.constraintDown = false;
          ih.mouse.constraint = false;
          ih.mouse.dragPositions = [];
          ih._resetPreRollState?.();
        } catch (e) { warn("cleanup: force-release post-hooks failed", e); }
      }
    }
  }

  // Removal sync semantics: must mirror the spawn's broadcast policy.
  //   spawned with sync=true  → broadcast=true (DSN syncs removal)
  //   spawned with sync=false → broadcast=false (local-only); for secret
  //     rolls we additionally emit `secret-mirror-cleanup` so receivers
  //     tear down their bridge-spawned mirror meshes.
  const wasSecret = store?._secret === true;
  const wasLocalOnly = store?._localOnly === true;
  const broadcastRemove = !wasLocalOnly;

  // If DSN is currently animating a throw, defer the actual removal by
  // 200ms so the physics worker isn't reading a mesh that's about to be
  // destroyed. The _spawnToken bump above already invalidates any
  // in-flight spawn — that part is sync. Cap the defer at 200ms; if the
  // throw is still rolling after that, proceed anyway (don't block
  // dialog close indefinitely on a stuck physics step).
  const throwEngine = dice3d.box?.throwEngine;
  const deferMs = throwEngine?.running ? 200 : 0;

  const doRemoval = () => {
    for (const id of ids) {
      try { dice3d.removePersistentDie(id, broadcastRemove); } catch {}
    }
    if (wasSecret && ids.length > 0) {
      emitSecretMirrorCleanup(ids);
    }
    if (store) store._spawnedMeshIds = [];
    if (ids.length > 0) {
      log(`autoSpawn: cleaned up ${ids.length} task dice for dialog ${dialogId} (secret=${wasSecret}, localOnly=${wasLocalOnly})`);
      // Defensive follow-up sweep: a non-secret broadcast spawn on a
      // receiver may race our removal broadcast (DSN's removal no-ops
      // on a not-yet-spawned mesh, then the spawn lands). A sweep 2s
      // later catches such orphans locally; remote receivers handle
      // theirs via their own periodic sweep + this hook on their side.
      setTimeout(() => {
        try { sweepOrphanTaskDice(); } catch (e) { warn("post-cleanup sweep failed", e); }
      }, 2000);
    }
  };

  if (deferMs > 0) setTimeout(doRemoval, deferMs);
  else doRemoval();
}

/**
 * Defensive sweep: scan DSN's `persistentDiceList` for any mesh tagged as
 * one of our task dice whose dialog is no longer registered, and remove it.
 * Catches edge cases where a dialog closed without firing the close hook
 * (e.g. mid-render error, application destroyed by some other path) and
 * left orphans on the canvas.
 *
 * Called on every dialog open and once on `ready` so receivers also clean
 * up any stale broadcast meshes from prior sessions.
 *
 * Always broadcasts removal — orphans may exist on multiple clients (from
 * a sync-spawn whose cleanup-broadcast never made it through), and we want
 * a single sweep to clear them everywhere.
 */
export function sweepOrphanTaskDice() {
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return 0;
  const activeDialogIds = new Set(SlotRegistry.all().map((s) => s.dialogId));
  const toRemove = [];
  const myId = game.user?.id;
  for (const mesh of list) {
    if (mesh?.userData?.dsnPF2eBridge_owned !== true) continue;
    const openerId = mesh.userData?.dsnPF2eBridge_openerUserId;
    const did = mesh.userData?.dsnPF2eBridge_dialogId;

    // Secret-mirror or foreign-broadcast task die (someone else's roll
    // mirrored or DSN-synced onto our canvas, then tagged by us via the
    // `task-mark` socket). For both, dialogId belongs to the OPENER's
    // dialog — not in our local SlotRegistry. Use opener-online check:
    // if the opener is offline, their cleanup broadcast can't reach us
    // and we sweep here. Active opener? Trust their broadcast (or our
    // periodic sweep when they eventually disconnect / close).
    if (mesh.userData?.dsnPF2eBridge_secretMirror === true || (openerId && openerId !== myId)) {
      const openerUser = openerId ? game.users.get(openerId) : null;
      if (!openerUser || openerUser.active !== true) toRemove.push(mesh);
      continue;
    }

    // Our own (locally-opened) task die: dialogId must be in our active
    // SlotRegistry. Anything else is an orphan from a dialog whose
    // close hook didn't fire (mid-render error / app destroyed).
    if (!did || !activeDialogIds.has(did)) toRemove.push(mesh);
  }
  if (toRemove.length === 0) return 0;
  for (const m of toRemove) {
    try {
      game.dice3d.removePersistentDie(m.userData.persistentId, true);
    } catch {}
  }
  log(`orphan sweep: removed ${toRemove.length} stale task dice`);
  return toRemove.length;
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
