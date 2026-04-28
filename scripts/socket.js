import { MOD_ID, log, warn } from "./constants.js";

/**
 * Cross-client sync for the `userData.lockedBy` field on task dice.
 *
 * DSN's spawnPersistentDie(synchronize=true) only syncs DSN-defined fields
 * (persistentId, dieType, appearances, etc). Our `lockedBy` set locally on
 * the mesh therefore never reaches other players, so on their side the
 * InputHandler sees `lockedBy === undefined` and lets them drag the die.
 *
 * We add a small socket channel that broadcasts lock/unlock decisions so
 * every client applies the same `lockedBy` value to the matching mesh.
 *
 * Race condition: our lock broadcast may arrive on the receiver before
 * DSN has finished creating the mesh from its own create-socket frame.
 * We handle that by parking the lock in `pendingLocks` and re-applying
 * whenever the persistent dice list mutates.
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

/**
 * Called by spawn-helper after spawning a task die or after the user toggles
 * the access lock. Broadcasts to all other clients AND applies locally for
 * symmetry (so the same code path is exercised everywhere).
 *
 * @param {string} persistentId  DSN-assigned id (mesh.userData.persistentId)
 * @param {string|null} lockedBy A user id, or null to clear the lock.
 */
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
  // The sender already set the local mesh; this is here for completeness in
  // case the caller didn't (idempotent).
  applyLock(persistentId, lockedBy);
}

function onSocketMessage(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.type === "lock") {
    applyLock(payload.persistentId, payload.lockedBy);
  }
}

function applyLock(persistentId, lockedBy) {
  const list = game.dice3d?.box?.persistentDiceList;
  const mesh = Array.isArray(list)
    ? list.find((m) => m?.userData?.persistentId === persistentId)
    : null;

  if (!mesh?.userData) {
    // Mesh hasn't arrived from DSN's create-sync yet on this client.
    // Park it; flushPendingLocks() will pick it up when the list mutates.
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
