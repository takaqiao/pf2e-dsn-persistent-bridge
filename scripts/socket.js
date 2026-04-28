import { MOD_ID, log, warn } from "./constants.js";

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

async function applyMirror(payload) {
  const visibility = decideViewerVisibility(payload);
  if (visibility === "skip") return;

  const dice3d = game.dice3d;
  if (!dice3d) return;

  // Ask DSN to spawn a local-only mesh with the same persistentId so
  // other modules that index by persistentId line up. We pass the ghost
  // appearance flag for the ghost case.
  try {
    const spawnOpts = {
      ownerUserId: payload.openerUserId,
      remotePersistentId: payload.persistentId,
    };
    if (visibility === "ghost") {
      const Dice3DCls = dice3d.constructor;
      const factory = dice3d.DiceFactory;
      if (Dice3DCls?.APPEARANCE && factory?.getAppearanceForDice) {
        const raw = Dice3DCls.APPEARANCE(game.user);
        const base = factory.getAppearanceForDice(raw, payload.dieType);
        spawnOpts.appearance = { ...base, isGhost: true };
      }
    }
    const mesh = await dice3d.spawnPersistentDie(
      payload.dieType,
      payload.position,
      spawnOpts,
      false, // never re-broadcast
    );
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
  for (const id of persistentIds || []) {
    try { dice3d.removePersistentDie(id, false); } catch {}
  }
}

/* -------- SECRET DISPLAY (HIDE-FOR-NON-GM) SYNC -------- */
//
// For ceremonial blind/gm rolls we let DSN sync the spawn (so GM gets the
// throw animation in real time + the value). The opener renders ghost
// locally via opts.appearance, but DSN's broadcast carries raw appearance,
// meaning every other client renders a *real* die with the actual value.
// That's correct for the GM but a leak for everyone else, so we tell
// non-GM, non-opener clients to set their mesh's visibility to false.

const pendingDisplayHides = new Map(); // persistentId -> { openerUserId }

export function emitSecretDisplay(payload) {
  if (!payload?.persistentId) return;
  try {
    game.socket?.emit(SOCKET_NAME, { type: "secret-display", ...payload });
  } catch (e) {
    warn("emitSecretDisplay failed", e);
  }
}

export function emitSecretDisplayCleanup(persistentIds) {
  if (!persistentIds?.length) return;
  try {
    game.socket?.emit(SOCKET_NAME, { type: "secret-display-cleanup", persistentIds });
  } catch (e) {
    warn("emitSecretDisplayCleanup failed", e);
  }
  // Clear local pending entries too.
  for (const id of persistentIds) pendingDisplayHides.delete(id);
}

function applySecretDisplay(payload) {
  // Receiver decision: opener and GM both keep visibility; everyone else hides.
  if (game.user?.id === payload.openerUserId) return;
  if (game.user?.isGM) return;

  const list = game.dice3d?.box?.persistentDiceList;
  const mesh = Array.isArray(list)
    ? list.find((m) => m?.userData?.persistentId === payload.persistentId)
    : null;
  if (!mesh) {
    pendingDisplayHides.set(payload.persistentId, { openerUserId: payload.openerUserId });
    return;
  }
  hideMeshSecretly(mesh);
}

function hideMeshSecretly(mesh) {
  // Set visibility off on mesh and parent group (DSN wraps in objectContainer).
  const targets = [mesh, mesh.parent].filter((t) => t && t !== mesh.parent || t);
  for (const t of [mesh, mesh.parent].filter(Boolean)) {
    if (t.visible !== false) t.visible = false;
  }
  if (mesh.userData) mesh.userData.dsnPF2eBridge_secretHidden = true;
}

// Re-apply pending hides whenever DSN's persistent list mutates (catches the
// race where our hide instruction arrives before DSN's spawn completes).
Hooks.on("dice-so-nice.persistentDiceChanged", () => {
  if (pendingDisplayHides.size === 0) return;
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return;
  for (const [id, info] of [...pendingDisplayHides]) {
    const mesh = list.find((m) => m?.userData?.persistentId === id);
    if (mesh) {
      // Re-check the same gating decision (opener / GM keep visibility).
      if (game.user?.id !== info.openerUserId && !game.user?.isGM) {
        hideMeshSecretly(mesh);
      }
      pendingDisplayHides.delete(id);
    }
  }
});

function applySecretDisplayCleanup({ persistentIds }) {
  for (const id of persistentIds || []) pendingDisplayHides.delete(id);
  // No mesh action needed: DSN's normal remove will clear the mesh whether
  // it's visible or hidden. (See cleanupTaskDiceForStore which calls
  // removePersistentDie with broadcast=true for ceremonial.)
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
    case "secret-display":
      applySecretDisplay(payload);
      break;
    case "secret-display-cleanup":
      applySecretDisplayCleanup(payload);
      break;
    default:
      // unknown / forward-compat — ignore
      break;
  }
}
