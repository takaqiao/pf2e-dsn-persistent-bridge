import { MOD_ID, log, warn } from "./constants.js";
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
    default:
      // unknown / forward-compat — ignore
      break;
  }
}
