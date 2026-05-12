import { MOD_ID, log, tagged, warn } from "./constants.js";
import { applyMirrorThrow } from "./ephemeral-mirror.js";

/**
 * Cross-client sync for two things:
 *
 *  1. The `userData.lockedBy` field on task dice. DSN's own spawn-sync does
 *     not include lockedBy, so we broadcast it ourselves.
 *
 *  2. SECRET-ROLL MIRRORS. The opener spawns their task dice locally
 *     (synchronize=false) so DSN doesn't broadcast a real-die spawn to other
 *     clients. We then emit a "secret-mirror" socket message describing the
 *     spawn; other clients receive it, decide based on their own role +
 *     the roll's mode whether they should see a real die, a ghost die, or
 *     nothing, and spawn a local mirror accordingly.
 *
 *     Visibility matrix (from the user's design):
 *       Self Roll  : opener real (spawned by opener), others ghost
 *       GM Roll    : GM real, opener (player) ghost, other players ghost
 *       Blind Roll : same as GM Roll
 *       Public     : not used here — handled by DSN's normal sync
 */

const SOCKET_NAME = `module.${MOD_ID}`;
const pendingLocks = new Map(); // persistentId -> userId | null

export function registerSocket() {
  if (!game.socket) {
    warn("game.socket not available");
    return;
  }
  game.socket.on(SOCKET_NAME, onSocketMessage);
  Hooks.on("dice-so-nice.persistentDiceChanged", flushPendingLocks);
  Hooks.on("dice-so-nice.persistentDiceChanged", flushPendingFlavorSync);
  log("socket registered:", SOCKET_NAME);
}

/* -------- LOCK SYNC -------- */

export function emitLockEvent(persistentId, lockedBy) {
  if (!persistentId) return;
  try {
    game.socket?.emit(SOCKET_NAME, {
      type: "lock",
      persistentId,
      lockedBy: lockedBy ?? null,
    });
  } catch (e) {
    warn("emitLockEvent socket failed", e);
  }
  applyLock(persistentId, lockedBy);
}

function applyLock(persistentId, lockedBy) {
  const list = game.dice3d?.box?.persistentDiceList;
  const mesh = Array.isArray(list)
    ? list.find((m) => m?.userData?.persistentId === persistentId)
    : null;

  if (!mesh?.userData) {
    pendingLocks.set(persistentId, lockedBy);
    return;
  }
  setLockOnMesh(mesh, lockedBy);
  pendingLocks.delete(persistentId);
}

function flushPendingLocks() {
  if (pendingLocks.size === 0) return;
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return;
  for (const [persistentId, lockedBy] of [...pendingLocks]) {
    const mesh = list.find((m) => m?.userData?.persistentId === persistentId);
    if (mesh?.userData) {
      setLockOnMesh(mesh, lockedBy);
      pendingLocks.delete(persistentId);
    }
  }
}

function setLockOnMesh(mesh, lockedBy) {
  if (!mesh?.userData) return;
  if (lockedBy === null || lockedBy === undefined) {
    delete mesh.userData.lockedBy;
  } else {
    mesh.userData.lockedBy = lockedBy;
  }
}

/* -------- SECRET MIRROR SYNC -------- */

/**
 * Tell every other client to spawn a mirror mesh for a secret roll. Each
 * receiver decides on its own whether the mirror is real, ghost, or skipped.
 *
 * @param {object} payload
 * @param {string} payload.mode             "self" | "gm" | "blind"
 * @param {string} payload.dieType          e.g. "d20"
 * @param {object} payload.position         {x, y} canvas-percent coords
 * @param {string} payload.persistentId
 * @param {string} payload.openerUserId
 * @param {string} payload.dialogId         opener's dialog appId — tagged
 *   onto the receiver's mirror mesh for orphan-sweep identification when
 *   the opener's cleanup broadcast was lost (network/disconnect).
 * @param {string|null} payload.flavor      PF2e damage type, if applicable
 */
export function emitSecretMirror(payload) {
  if (!payload?.persistentId) return;
  try {
    game.socket?.emit(SOCKET_NAME, { type: "mirror", ...payload });
  } catch (e) {
    warn("emitSecretMirror failed", e);
  }
}

/** Tell every other client to remove their mirror meshes for these IDs. */
export function emitSecretMirrorCleanup(persistentIds) {
  if (!persistentIds?.length) return;
  try {
    game.socket?.emit(SOCKET_NAME, { type: "mirror-cleanup", persistentIds });
  } catch (e) {
    warn("emitSecretMirrorCleanup failed", e);
  }
}

function decideViewerVisibility({ mode, openerUserId }) {
  // Opener's mesh was spawned by themselves locally; never re-spawn here.
  if (game.user?.id === openerUserId) return "skip";

  const isGM = !!game.user?.isGM;
  if (mode === "self") {
    // self: only the roller (opener) sees real; everyone else (incl. GM) sees ghost
    return "ghost";
  }
  if (mode === "gm" || mode === "blind") {
    // GM sees the real die; everyone else (other players) sees ghost
    return isGM ? "real" : "ghost";
  }
  // unknown mode → skip
  return "skip";
}

/**
 * Cleanup race protection: if `mirror-cleanup` for a persistentId arrives
 * while `applyMirror` is still awaiting `spawnPersistentDie` for that same
 * id, the cleanup's removePersistentDie() finds nothing on the list and
 * no-ops. Then the spawn finishes and the mesh becomes a permanent orphan
 * on the receiver. We track recently-cleaned-up ids in a small Set so the
 * spawn-completion path can detect "you arrived too late" and self-remove.
 */
const recentlyCleanedUpMirrors = new Set();
const MIRROR_CLEANUP_REMEMBER_MS = 5000;

async function applyMirror(payload) {
  const visibility = decideViewerVisibility(payload);
  if (visibility === "skip") return;

  const dice3d = game.dice3d;
  if (!dice3d) return;

  // Ask DSN to spawn a local-only mesh with the same persistentId so
  // other modules that index by persistentId line up. We pass appearance
  // (flavor-aware base + optional ghost flag) so each receiver renders
  // using THEIR own DSN damageTypeMap settings rather than inheriting the
  // opener's color preferences.
  try {
    const spawnOpts = {
      ownerUserId: payload.openerUserId,
      remotePersistentId: payload.persistentId,
      // Bypass the restrictPlayerPersistentDice gate — secret-mirror spawns
      // are bridge-driven, not user-initiated.
      _dsnBridgeAllowed: true,
    };
    const wantGhost = visibility === "ghost";
    if (wantGhost || payload.flavor) {
      const Dice3DCls = dice3d.constructor;
      const factory = dice3d.DiceFactory;
      if (Dice3DCls?.APPEARANCE && factory?.getAppearanceForDice) {
        const raw = Dice3DCls.APPEARANCE(game.user);
        const flavorEnabled =
          payload.flavor && game.dice3d?.userConfig?.enableFlavorColorset !== false;
        const term = flavorEnabled
          ? { options: { type: payload.flavor, flavor: payload.flavor } }
          : null;
        const base = factory.getAppearanceForDice(raw, payload.dieType, term);
        // Same colorset-name patch as spawn-helper.buildSlotAppearance —
        // see that function for the full explanation; without this the
        // mirror mesh renders with the receiver's default appearance instead
        // of the flavor-mapped colorset.
        if (base && flavorEnabled && !base.colorset) {
          base.colorset = base.name ?? payload.flavor;
        }
        spawnOpts.appearance = wantGhost ? { ...base, isGhost: true } : base;
      }
    }
    const mesh = await dice3d.spawnPersistentDie(
      payload.dieType,
      payload.position,
      spawnOpts,
      false, // never re-broadcast
    );

    // Race guard: a `mirror-cleanup` may have arrived during the spawn
    // await. If so, the cleanup couldn't find the mesh (it didn't exist
    // yet) and silently no-op'd. Now that we have the mesh, immediately
    // remove it ourselves — otherwise the opener's dialog has long since
    // closed but our receiver-side mirror lives on as an orphan.
    if (recentlyCleanedUpMirrors.has(payload.persistentId)) {
      try { dice3d.removePersistentDie(payload.persistentId, false); } catch {}
      log(`secret mirror discarded (cleanup arrived during spawn) id=${payload.persistentId}`);
      return;
    }
    if (mesh?.userData) {
      mesh.userData.dsnPF2eBridge_secretMirror = true;
      // Sweep recognition: `_owned` lets sweepOrphanTaskDice pick up this
      // mesh as a bridge-managed mirror; the `_secretMirror` flag tells
      // it to use the opener-online check instead of the local-dialog
      // check. Without these, mirrors that miss the cleanup broadcast
      // (network drop / late join) persist on canvas forever — exactly
      // the "logging in and finding stale persistent dice" bug Chasarooni
      // reported in v0.4.5.
      mesh.userData.dsnPF2eBridge_owned = true;
      mesh.userData.dsnPF2eBridge_dialogId = payload.dialogId ?? null;
      mesh.userData.dsnPF2eBridge_openerUserId = payload.openerUserId;
      // Mirror meshes are display-only — nobody on this client should be
      // able to drag/throw them. Lock them to the opener so DSN's
      // InputHandler rejects every drag attempt on this client.
      mesh.userData.lockedBy = payload.openerUserId;
    }
    log(`secret mirror spawned (${visibility}) persistentId=${payload.persistentId}`);
  } catch (e) {
    warn("secret mirror spawn failed", e);
  }
}

function applyMirrorCleanup({ persistentIds }) {
  const dice3d = game.dice3d;
  if (!dice3d) return;
  for (const id of (persistentIds || [])) {
    if (!id) continue;
    // Mark BEFORE we attempt removal: applyMirror's spawn-completion path
    // checks this set, so a tardy cleanup that arrived mid-spawn still
    // gets honored when the spawn finally lands.
    recentlyCleanedUpMirrors.add(id);
    setTimeout(() => recentlyCleanedUpMirrors.delete(id), MIRROR_CLEANUP_REMEMBER_MS);
    try { dice3d.removePersistentDie(id, false); } catch {}
  }
}

/* -------- TASK FLAVOR SYNC (public PC rolls) -------- */
//
// For public PC damage rolls, the opener's task die is broadcast via DSN's
// own spawn-sync (synchronize=true). DSN broadcasts only the opener's RAW
// user appearance — no flavor info — so receivers compute appearance via
// `getAppearanceForDice(raw, dieType)` (no term) and end up with the
// opener's default die, not the per-damage-type colorset. Symptom: a fire
// damage task die spawned on the opener looks fire-themed (we passed
// flavored appearance via spawnOpts), but on every other client it
// appears in the opener's default scheme.
//
// We close the gap by sending a separate `task-flavor-sync` socket message
// after each successful flavored spawn. Receivers listen, build appearance
// using THEIR own DSN settings + opener's flavor, and swap the existing
// mesh's material in place. No mesh remove/respawn (no flicker), no
// physics shape recreation (we use a non-persistent textureCache when
// asking the factory to build the material so its physics-shape branch
// short-circuits).
//
// Race: if our flavor message arrives before DSN's spawn finishes on the
// receiver, we cache the flavor by persistentId and apply on the next
// `dice-so-nice.persistentDiceChanged` hook fire (when the mesh lands).

const pendingFlavorSync = new Map(); // persistentId -> { flavor, ts }
const FLAVOR_SYNC_TTL_MS = 30000;
const FLAVOR_TAG = "[PF2e×DSN flavor-sync]";
const flavorDiag = tagged(FLAVOR_TAG);

export function emitTaskFlavorSync({ persistentId, flavor }) {
  if (!persistentId || !flavor) return;
  try {
    game.socket?.emit(SOCKET_NAME, { type: "task-flavor-sync", persistentId, flavor });
    flavorDiag(`emit: ${persistentId} → ${flavor}`);
  } catch (e) {
    warn("emitTaskFlavorSync failed", e);
  }
}

async function applyTaskFlavorSync(payload) {
  const { persistentId, flavor } = payload || {};
  if (!persistentId || !flavor) return;
  flavorDiag(`receive: ${persistentId} → ${flavor}`);
  // Receiver opted out of flavor coloring — respect their setting.
  if (game.dice3d?.userConfig?.enableFlavorColorset === false) {
    flavorDiag(`receive: skipped (enableFlavorColorset=false)`);
    return;
  }

  const list = game.dice3d?.box?.persistentDiceList ?? [];
  const mesh = list.find((m) => m?.userData?.persistentId === persistentId);
  if (!mesh) {
    // Spawn message hasn't been processed yet on this receiver. Cache the
    // flavor; flushPendingFlavorSync (on persistentDiceChanged) will pick
    // it up when the mesh lands.
    flavorDiag(`receive: mesh not yet on canvas, queued for flush`);
    pendingFlavorSync.set(persistentId, { flavor, ts: Date.now() });
    setTimeout(() => pendingFlavorSync.delete(persistentId), FLAVOR_SYNC_TTL_MS);
    return;
  }
  await applyFlavoredAppearance(mesh, flavor);
}

async function applyFlavoredAppearance(mesh, flavor) {
  const dice3d = game.dice3d;
  const Dice3DCls = dice3d?.constructor;
  const factory = dice3d?.DiceFactory;
  if (!Dice3DCls?.APPEARANCE || typeof factory?.getAppearanceForDice !== "function") {
    flavorDiag(`apply: skipped (Dice3D APPEARANCE/factory unavailable)`);
    return;
  }
  // Skip our own meshes — opener already spawned with flavored appearance.
  if (mesh.userData?.dsnPF2eBridge_owned === true &&
      mesh.userData?.ownerUserId === game.user?.id) {
    flavorDiag(`apply: skipped (this is opener's own mesh)`);
    return;
  }
  // Skip mirror meshes — secret-mirror flow handled their flavor at spawn.
  if (mesh.userData?.dsnPF2eBridge_secretMirror) {
    flavorDiag(`apply: skipped (secret-mirror mesh, flavor done at spawn)`);
    return;
  }
  // Already flavored (idempotency on flush race).
  if (mesh.userData?.dsnPF2eBridge_flavorApplied === flavor) {
    flavorDiag(`apply: skipped (already applied flavor=${flavor})`);
    return;
  }

  const dieType = mesh.notation?.compositeType ?? mesh.notation?.type;
  if (!dieType) {
    flavorDiag(`apply: skipped (no dieType on mesh.notation)`);
    return;
  }

  // Build the appearance using the RECEIVER's own DSN settings + opener's
  // flavor. Same shape as spawn-helper.buildSlotAppearance for consistency.
  const raw = Dice3DCls.APPEARANCE(game.user);
  const term = { options: { type: flavor, flavor } };
  const appearance = factory.getAppearanceForDice(raw, dieType, term);
  if (!appearance) {
    flavorDiag(`apply: skipped (getAppearanceForDice returned null)`);
    return;
  }
  if (!appearance.colorset) {
    appearance.colorset = appearance.name ?? flavor;
  }
  flavorDiag(`apply: built appearance for ${dieType} ${flavor} →`, {
    colorset: appearance.colorset,
    foreground: appearance.foreground,
    background: Array.isArray(appearance.background) ? `[${appearance.background.length} colors]` : appearance.background,
    texture: typeof appearance.texture === "object" ? appearance.texture?.name : appearance.texture,
  });

  // Snapshot mesh state for re-spawn.
  const persistentId = mesh.userData.persistentId;
  const ownerUserId = mesh.userData.ownerUserId;
  const linkGroupId = mesh.userData.linkGroupId;
  const linkGroupSecondary = mesh.userData.linkGroupSecondary;
  const digitPlace = mesh.userData.digitPlace;
  // Approximate canvas-percent position from the mesh's current world
  // position so the re-spawned mesh appears in the same spot.
  const pos = (() => {
    try {
      const wx = mesh.parent?.position?.x ?? 0;
      const wz = mesh.parent?.position?.z ?? 0;
      return dice3d.box?._toPositionPct?.(wx, wz) ?? null;
    } catch { return null; }
  })();

  try {
    // Remove the broadcast-spawned mesh locally (no broadcast — receivers
    // shouldn't propagate this remove to other clients) and re-spawn it
    // locally with flavored appearance. The persistentId is preserved so
    // DSN's throw replay continues to find the mesh by id.
    //
    // Why not just swap mesh.material? Three.js material reassignment is
    // theoretically supported but in practice DSN's renderer has internal
    // shader+geometry program caches keyed by the original material's
    // uuid; live-swapping the material doesn't always pick up the new
    // texture atlas / colorset. Remove+respawn goes through the full
    // render setup and is reliable. The receiver sees a single-frame
    // flicker (~16ms) which is imperceptible vs. the throw animation that
    // typically follows immediately after.
    await dice3d.removePersistentDie(persistentId, false);
    await dice3d.spawnPersistentDie(dieType, pos, {
      ownerUserId,
      remotePersistentId: persistentId,
      linkGroupId,
      linkGroupSecondary,
      digitPlace,
      appearance,
      // Bypass the restrictPlayerPersistentDice gate — flavor-sync re-spawn
      // recreates a bridge-owned task die, not a user-initiated decorative.
      _dsnBridgeAllowed: true,
    }, false); // synchronize=false: local-only re-spawn

    // Tag the new mesh so we don't reapply on re-flush of stale pending.
    const list = game.dice3d?.box?.persistentDiceList ?? [];
    const newMesh = list.find((m) => m?.userData?.persistentId === persistentId);
    if (newMesh?.userData) newMesh.userData.dsnPF2eBridge_flavorApplied = flavor;

    flavorDiag(`apply: re-spawned ${dieType} (id=${persistentId}) with ${flavor} colorset`);
  } catch (e) {
    warn("applyFlavoredAppearance failed", e);
    flavorDiag(`apply: error`, e);
  }
}

function flushPendingFlavorSync() {
  if (pendingFlavorSync.size === 0) return;
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return;
  flavorDiag(`flush: ${pendingFlavorSync.size} pending`);
  for (const [id, entry] of [...pendingFlavorSync]) {
    const mesh = list.find((m) => m?.userData?.persistentId === id);
    if (!mesh) continue;
    pendingFlavorSync.delete(id);
    flavorDiag(`flush: applying ${entry.flavor} to ${id}`);
    applyFlavoredAppearance(mesh, entry.flavor)
      .catch((e) => warn("flushPendingFlavorSync failed", e));
  }
}

/* -------- SOCKET ROUTER -------- */

function onSocketMessage(payload) {
  if (!payload || typeof payload !== "object") return;
  switch (payload.type) {
    case "lock":
      applyLock(payload.persistentId, payload.lockedBy);
      break;
    case "mirror":
      applyMirror(payload);
      break;
    case "mirror-cleanup":
      applyMirrorCleanup(payload);
      break;
    case "task-mirror-throw":
      applyMirrorThrow(payload);
      break;
    case "task-flavor-sync":
      applyTaskFlavorSync(payload);
      break;
    default:
      // unknown / forward-compat — ignore
      break;
  }
}
