import { MOD_ID, PENDING_TTL_MS } from "./constants.js";

/**
 * Slot state machine: empty → filled → locked.
 * One SlotStore per open PF2e roll dialog.
 *
 * The store is also the bridge to the evaluate wrapper:
 * on submit, predetermined values are pushed to a per-user PENDING queue,
 * and the wrapper consumes them when a Roll evaluates.
 */

const STATES = Object.freeze({
  EMPTY: "empty",
  FILLED: "filled",
  LOCKED: "locked",
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
    this.notify();
    return slot;
  }

  toggleLock(key) {
    const slot = this.slots.find((s) => s.key === key);
    if (!slot) return;
    if (slot.state === STATES.FILLED) slot.state = STATES.LOCKED;
    else if (slot.state === STATES.LOCKED) slot.state = STATES.FILLED;
    this.notify();
  }

  clearSlot(key) {
    const slot = this.slots.find((s) => s.key === key);
    if (!slot || slot.state === STATES.LOCKED) return;
    releaseMeshClaim(slot.sourceMeshId);
    slot.state = STATES.EMPTY;
    slot.value = null;
    slot.sourceMeshId = null;
    this.notify();
  }

  clearAllUnlocked() {
    for (const slot of this.slots) {
      if (slot.state === STATES.LOCKED) continue;
      releaseMeshClaim(slot.sourceMeshId);
      slot.state = STATES.EMPTY;
      slot.value = null;
      slot.sourceMeshId = null;
    }
    this.notify();
  }

  rngAll() {
    // Mark every slot as "explicitly empty" so submit doesn't push predetermined values.
    for (const slot of this.slots) {
      if (slot.state !== STATES.LOCKED) {
        releaseMeshClaim(slot.sourceMeshId);
        slot.state = STATES.EMPTY;
        slot.value = null;
        slot.sourceMeshId = null;
      }
    }
    this.notify();
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

  /** Mesh ids that were used to fill slots, so we can auto-remove after consume. */
  getConsumedMeshIds() {
    return this.slots
      .filter((s) => s.state !== STATES.EMPTY && s.sourceMeshId)
      .map((s) => s.sourceMeshId);
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
  forUser(userId) {
    const out = [];
    for (const s of stores.values()) {
      if (!userId || s.dialog?.user?.id === userId || !s.dialog?.user) out.push(s);
    }
    return out;
  },
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
  clear(userId) { PENDING.delete(userId); },
};

/** Find the mesh by persistentId in DSN's live list and unset our consumed flag. */
function releaseMeshClaim(meshId) {
  if (!meshId) return;
  const list = game?.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return;
  for (const m of list) {
    if (m?.userData?.persistentId === meshId) {
      if (m.userData) m.userData.dsnPF2eBridge_consumed = false;
      return;
    }
  }
}

export { STATES };
