import { log } from "./constants.js";

/**
 * Receiver-side optimization for DSN visibility = "mine" / "none".
 *
 * Background: when another player opens a roll dialog, our opener-side
 * spawn broadcasts task dice to every client. On a receiver whose
 * visibility is "mine" or "none", the mesh's parent group is invisible
 * but the mesh stays in `persistentDiceList`. DSN's physics worker steps
 * every die in that list each frame — even at rest, even invisible —
 * so accumulated idle dice across long sessions add measurable cost.
 *
 * What this module does: while hidden-viewer mode is active and there
 * are foreign task dice on the canvas, poll at 4 Hz. As soon as a
 * foreign task die has settled (forcedResult populated, persistentThrow
 * cleared), remove it locally — the throw animation has just played, the
 * value is captured, the user has no reason to keep the mesh around.
 *
 * Trade-off: there is still a brief idle window before the throw (the
 * dice exist hidden between dialog-open and throw-start on opener), but
 * post-throw idle collapses to ~200 ms. Eliminating pre-throw idle would
 * require deferring DSN's broadcast spawn to throw-start, which is more
 * involved (separate work item).
 *
 * Local removal only — broadcast=false. The opener's own cleanup at
 * dialog close still broadcasts the canonical removal; if that hits us
 * after we already removed locally, DSN's removePersistentDie no-ops.
 */

const POLL_MS = 250;
const REMOVE_GRACE_MS = 200;
let pollTimer = null;
const scheduledRemovals = new Set();

function isHiddenViewer() {
  const v = game?.dice3d?.persistentDiceVisibility;
  return v === "mine" || v === "none";
}

function getForeignTaskDice() {
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return [];
  const myId = game.user?.id;
  return list.filter(
    (m) =>
      m?.userData?.dsnPF2eBridge_owned === true &&
      m.userData.ownerUserId !== myId
  );
}

function isSettled(mesh) {
  return mesh?.forcedResult != null && !mesh?.persistentThrow;
}

function tick() {
  if (!isHiddenViewer()) {
    stop();
    return;
  }
  const foreigners = getForeignTaskDice();
  if (foreigners.length === 0) {
    stop();
    return;
  }
  for (const mesh of foreigners) {
    const id = mesh.userData?.persistentId;
    if (!id || scheduledRemovals.has(id)) continue;
    if (!isSettled(mesh)) continue;
    scheduledRemovals.add(id);
    setTimeout(() => {
      try {
        game.dice3d.removePersistentDie(id, false);
      } catch {}
      scheduledRemovals.delete(id);
    }, REMOVE_GRACE_MS);
  }
}

function start() {
  if (pollTimer) return;
  pollTimer = setInterval(tick, POLL_MS);
  log("foreign-mirror cleaner: poll started");
}

function stop() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
  log("foreign-mirror cleaner: poll stopped");
}

export function startForeignMirrorCleaner() {
  Hooks.on("dice-so-nice.persistentDiceChanged", () => {
    if (!isHiddenViewer()) {
      stop();
      return;
    }
    if (getForeignTaskDice().length > 0) start();
    else stop();
  });
  log("foreign-mirror cleaner: hook registered");
}
