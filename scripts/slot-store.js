import { PENDING_TTL_MS } from "./constants.js";

/**
 * Slot state machine: empty → filled.
 * One SlotStore per open PF2e roll dialog.
 *
 * The store is also the bridge to the evaluate wrapper:
 * on submit, predetermined values are pushed to a per-user PENDING queue,
 * and the wrapper consumes them when a Roll evaluates.
 */

const STATES = Object.freeze({
  EMPTY: "empty",
  FILLED: "filled",
});

// dialog.appId -> SlotStore
const stores = new Map();
// userId -> { predetermined: Array<{faces:number, value:number}|null>, ts:number, source:"submit"|"reroll" }
const PENDING = new Map();

export class SlotStore {
  constructor(dialog, slotDescriptors) {
    this.dialogId = dialog.appId;
    this.dialog = dialog;
    this.slots = slotDescriptors.map((d) => ({
      key: d.key,
      faces: d.faces,
      flavor: d.flavor ?? null,
      state: STATES.EMPTY,
      value: null,
      sourceMeshId: null,
    }));
    this.subscribers = new Set();
  }

  /** UI subscribers re-render when state changes. */
  subscribe(fn) { this.subscribers.add(fn); return () => this.subscribers.delete(fn); }
  notify() { for (const fn of this.subscribers) try { fn(this); } catch (e) { console.error(e); } }

  get isAllFilled() { return this.slots.every((s) => s.state !== STATES.EMPTY); }
  get hasAnyFilled() { return this.slots.some((s) => s.state !== STATES.EMPTY); }
  get hasAnyEmpty() { return this.slots.some((s) => s.state === STATES.EMPTY); }

  /**
   * Try to place an incoming DSN result into the first matching empty slot.
   * Returns the slot that was filled, or null if no match.
   */
  acceptResult({ faces, value, meshId }) {
    if (!Number.isFinite(value)) return null;
    const slot = this.slots.find((s) => s.state === STATES.EMPTY && s.faces === faces);
    if (!slot) return null;
    slot.state = STATES.FILLED;
    slot.value = value;
    slot.sourceMeshId = meshId ?? null;
    // Hide the value from the slot's own UI when this store is rolling for a
    // mode where the opener should not learn the result (player blind/gm).
    // The value still gets fed to PF2e via toPredetermined() — this only
    // affects what's painted in the tray.
    slot.hidden = this._hideValues === true;
    this.notify();
    return slot;
  }

  /**
   * Build the predetermined queue used by evaluate-wrapper.
   * Returns array in slot order; each entry is {faces, value} or null for "leave to RNG".
   */
  toPredetermined() {
    return this.slots.map((s) =>
      s.state === STATES.EMPTY ? null : { faces: s.faces, value: s.value }
    );
  }
}

export const SlotRegistry = {
  create(dialog, descriptors) {
    const store = new SlotStore(dialog, descriptors);
    stores.set(dialog.appId, store);
    return store;
  },
  get(appId) { return stores.get(appId); },
  delete(appId) { stores.delete(appId); },
  /** All currently-open SlotStores (used by DSN listener to dispatch). */
  all() { return [...stores.values()]; },
};

/** Per-user pending hand-off from dialog submit to evaluate wrapper. */
export const PendingQueue = {
  push(userId, predetermined, source = "submit") {
    if (!predetermined?.some((p) => p)) return; // nothing to push
    PENDING.set(userId, { predetermined, ts: Date.now(), source });
  },
  pop(userId) {
    const entry = PENDING.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.ts > PENDING_TTL_MS) {
      PENDING.delete(userId);
      return null;
    }
    PENDING.delete(userId);
    return entry;
  },
  peek(userId) {
    const entry = PENDING.get(userId);
    if (!entry) return null;
    if (Date.now() - entry.ts > PENDING_TTL_MS) {
      PENDING.delete(userId);
      return null;
    }
    return entry;
  },
};
