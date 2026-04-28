import { log } from "./constants.js";
import { SlotRegistry } from "./slot-store.js";

/**
 * Dispatch a freshly-rolled DSN persistent die to whichever open SlotStore
 * has a matching empty slot. Returns true if consumed.
 *
 * Stores are tried in insertion order (FIFO of open dialogs); since each die
 * carries an `ownerUserId`, dialogs opened by that user get a natural priority
 * because their stores were created on the same client that's dispatching.
 */
export function dispatchDie(die) {
  const stores = SlotRegistry.all();
  if (stores.length === 0) return false;

  for (const store of stores) {
    const slot = store.acceptResult(die);
    if (slot) {
      log("matched die →", {
        dieFaces: die.faces,
        value: die.value,
        ownerId: die.ownerUserId,
        dialogId: store.dialogId,
        slotKey: slot.key,
      });
      return true;
    }
  }
  return false;
}

/**
 * Decide whether this client should consume a die rolled by `ownerUserId`.
 * The module is single-owner by design (the dialog opener is the only one who
 * should see / interact with task dice), so we always require owner match.
 * Cooperative-play (any owner) was a v0.1.x setting that turned out to be
 * incompatible with secret-roll handling, so it was removed.
 */
export function ownerEligible(ownerUserId) {
  return ownerUserId === game.user.id;
}
