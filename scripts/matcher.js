import { SETTINGS, getSetting, log } from "./constants.js";
import { SlotRegistry } from "./slot-store.js";

/**
 * Dispatch a freshly-rolled DSN persistent die to whichever open SlotStore
 * has a matching empty slot. Returns true if consumed.
 */
export function dispatchDie(die) {
  const stores = SlotRegistry.all();
  if (stores.length === 0) return false;

  const priority = getSetting(SETTINGS.matchPriority) ?? "byOwnerThenType";
  const ordered = orderStores(stores, die, priority);

  for (const store of ordered) {
    const slot = store.acceptResult(die);
    if (slot) {
      log("matched die →", { dieFaces: die.faces, value: die.value, ownerId: die.ownerUserId, dialogId: store.dialogId, slotKey: slot.key });
      return true;
    }
  }
  return false;
}

function orderStores(stores, die, priority) {
  if (priority === "byType") return stores; // first opened wins
  if (priority === "fifoStrict") {
    // pure FIFO of open dialogs: stores Map is insertion ordered
    return stores;
  }
  // byOwnerThenType (default): prefer the dialog whose owner === die.ownerUserId
  return [...stores].sort((a, b) => {
    const aMatch = a.dialog?.user?.id === die.ownerUserId ? 0 : 1;
    const bMatch = b.dialog?.user?.id === die.ownerUserId ? 0 : 1;
    return aMatch - bMatch;
  });
}

/**
 * Decide whether this client should consume a die rolled by `ownerUserId`.
 * Default: only own dice; world setting `consumeAnyOwner` lifts the gate.
 */
export function ownerEligible(ownerUserId) {
  if (getSetting(SETTINGS.consumeAnyOwner) === true) return true;
  return ownerUserId === game.user.id;
}
