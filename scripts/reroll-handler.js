import { SETTINGS, getSetting, log, warn } from "./constants.js";
import { PendingQueue } from "./slot-store.js";
import { ownerEligible } from "./matcher.js";

/**
 * pf2e.preReroll fires synchronously immediately before evaluate().
 * Workflow: player should roll the persistent die FIRST, then click reroll.
 * We scan unconsumed persistent dice on the canvas, match by faces required
 * by the reroll formula, and push values to PendingQueue so the
 * evaluate-wrapper picks them up on the in-flight reroll.evaluate() call.
 */
export function onPreReroll(_oldRoll, unevaluatedNewRoll /* , resource, options */) {
  if (getSetting(SETTINGS.applyToReroll) === false) return;

  try {
    const facesNeeded = countFacesInRoll(unevaluatedNewRoll);
    if (facesNeeded.size === 0) return;

    const harvested = harvestUnconsumedDice(facesNeeded);
    if (harvested.length === 0) {
      log("reroll: no unconsumed persistent dice match — falling back to RNG");
      return;
    }

    const userId = game.user?.id;
    if (!userId) return; // defensive: no user means no queue
    PendingQueue.push(userId, harvested, "reroll");
    log("reroll: pushed predetermined values from canvas:", harvested);

    // Always nuke the spent meshes from canvas — they're tagged
    // `_consumed=true` so they can't be re-harvested, but visually they
    // look identical to fresh dice and confuse the next reroll attempt.
    const meshIds = harvested.map((h) => h?.meshId).filter(Boolean);
    scheduleAutoRemove(meshIds);
  } catch (e) {
    warn("reroll handler failed", e);
  }
}

function countFacesInRoll(roll) {
  const out = new Map();
  try {
    const Die = foundry?.dice?.terms?.Die ?? globalThis.Die;
    const dice = roll?.dice ?? [];
    for (const t of dice) {
      if (Die && !(t instanceof Die)) continue;
      const f = t.faces;
      const n = t.number ?? 1;
      out.set(f, (out.get(f) ?? 0) + n);
    }
  } catch {}
  return out;
}

function harvestUnconsumedDice(facesNeeded) {
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return [];

  const harvested = []; // ordered: same shape as predetermined queue
  const need = new Map(facesNeeded); // mutable copy

  // Preserve user's order: walk the dice list once, picking unconsumed dice.
  for (const mesh of list) {
    if (!mesh) continue;
    if (mesh.userData?.dsnPF2eBridge_consumed) continue;
    if (mesh.userData?.linkGroupSecondary === true) continue;
    // DSN stores thrown persistent die results on `forcedResult`, not `result`.
    const raw = mesh.forcedResult;
    const value = Number(raw);
    if (raw == null || !Number.isFinite(value)) continue;
    if (!ownerEligible(mesh.userData?.ownerUserId)) continue;

    const compositeType = mesh.notation?.compositeType;
    const compositeValue = mesh.notation?.compositeResult;
    const faces = parseFaces(compositeType ?? mesh.notation?.type);
    if (!faces) continue;
    const remaining = need.get(faces) ?? 0;
    if (remaining <= 0) continue;

    harvested.push({
      faces,
      value: Number.isFinite(compositeValue) ? compositeValue : value,
      meshId: mesh.userData?.persistentId,
    });
    need.set(faces, remaining - 1);
    if (mesh.userData) mesh.userData.dsnPF2eBridge_consumed = true;
  }

  return harvested;
}

function parseFaces(notationType) {
  if (typeof notationType !== "string") return null;
  const m = /^d(\d+)$/i.exec(notationType.trim());
  return m ? parseInt(m[1], 10) : null;
}

function scheduleAutoRemove(meshIds) {
  if (!meshIds?.length) return;
  setTimeout(() => {
    try {
      const dice3d = game.dice3d;
      if (!dice3d) return;
      for (const id of meshIds) {
        try { dice3d.removePersistentDie(id, true); } catch {}
      }
    } catch {}
  }, 1500);
}
