import { MOD_ID, SETTINGS, getSetting, isEnabled, log, err } from "./constants.js";
import { extractSlots } from "./slot-extractor.js";
import { SlotRegistry, PendingQueue } from "./slot-store.js";
import { compat } from "./compat.js";
import {
  spawnTaskDiceForStore,
  cleanupTaskDiceForStore,
  hideDecorativeDice,
  restoreDecorativeDiceIfNoActiveDialogs,
  raiseDsnCanvasAboveAll,
  toggleTaskDiceLock,
  selectAllTaskDice,
} from "./spawn-helper.js";

const TEMPLATE = `modules/${MOD_ID}/templates/slot-tray.hbs`;

export async function onRenderCheckDialog(app, $html /*, data */) {
  if (!isEnabled()) return;
  await injectTray(app, $html);
}

export async function onRenderDamageDialog(app, $html /*, data */) {
  if (!isEnabled()) return;
  await injectTray(app, $html);
}

export function onCloseDialog(app /*, options */) {
  // Pull a snapshot before destroying the store: if the form was submitted (isResolved/isRolled),
  // and we have any filled slots, push them to the per-user PENDING queue so the wrapper sees them.
  if (app._dsnBridgeUnsub) { try { app._dsnBridgeUnsub(); } catch {} app._dsnBridgeUnsub = null; }
  const store = SlotRegistry.get(app.appId);
  if (!store) return;
  const submitted = isDialogSubmitted(app);
  if (submitted && store.hasAnyFilled) {
    const requireAll = getSetting(SETTINGS.requireAllSlots) === true;
    if (requireAll && store.hasAnyEmpty) {
      // user is enforcing all-or-nothing; on incomplete, do not feed into PF2e (fall back to RNG)
      log("submit blocked by requireAllSlots: incomplete, falling back to RNG");
    } else {
      const predetermined = store.toPredetermined();
      PendingQueue.push(game.user.id, predetermined, "submit");
      log("dialog submitted, pushed predetermined values:", predetermined);
    }
  }
  // Always clean up task dice we spawned for this dialog, regardless of
  // submit / cancel. User-spawned decorative dice are untouched (they were
  // only hidden — restored below if no other dialog is still open).
  cleanupTaskDiceForStore(store);
  SlotRegistry.delete(app.appId);
  restoreDecorativeDiceIfNoActiveDialogs();
}

function isDialogSubmitted(app) {
  // CheckModifiersDialog -> isResolved; DamageModifierDialog -> isRolled
  return app?.isResolved === true || app?.isRolled === true;
}

async function injectTray(app, $html) {
  try {
    const root = unwrap($html);
    if (!root) return;

    // Don't double-inject on re-render
    let existing = root.querySelector(".dsn-bridge-tray");

    const descriptors = extractSlots(app);
    const isFresh = !SlotRegistry.get(app.appId);
    const store = SlotRegistry.get(app.appId)
      ?? SlotRegistry.create(app, descriptors);

    // If descriptors changed (e.g. user toggled a damage die), refresh the store
    // and re-spawn task dice to match the new shape.
    if (slotsShapeChanged(store, descriptors)) {
      cleanupTaskDiceForStore(store);
      store.slots = descriptors.map((d) => ({
        key: d.key, faces: d.faces, state: "empty", value: null, sourceMeshId: null,
      }));
      // Re-spawn for the new shape on the next tick
      spawnTaskDiceForStore(store).catch((e) => err("respawn failed", e));
    } else if (isFresh && descriptors.length > 0) {
      // First render of this dialog: spawn the task dice and visually hide
      // any decorative (user-spawned) dice while the dialog is up.
      hideDecorativeDice();
      spawnTaskDiceForStore(store).catch((e) => err("spawn failed", e));
    }

    const html = await renderTrayHTML(app, store);
    if (existing) {
      existing.outerHTML = html;
    } else {
      const anchor = root.querySelector("form.check-modifiers-content > button[type=submit]");
      if (!anchor) return;
      anchor.insertAdjacentHTML("afterend", html);
    }

    bindTrayHandlers(root, store);
    bindMessageModeWatcher(root, store, app);

    // Replace any prior subscriber on this app so we don't accumulate listeners across re-renders
    if (app._dsnBridgeUnsub) { try { app._dsnBridgeUnsub(); } catch {} }
    app._dsnBridgeUnsub = store.subscribe(async (s) => {
      const updated = await renderTrayHTML(app, s);
      const cur = root.querySelector(`.dsn-bridge-tray[data-app-id="${app.appId}"]`);
      if (cur) {
        cur.outerHTML = updated;
        bindTrayHandlers(root, s);
      }

      // Auto-submit the dialog when every slot is filled (default on).
      // The configurable delay lets the user see the dice settle and the slot
      // turn green before the dialog auto-closes.
      if (
        getSetting(SETTINGS.autoSubmitOnFill) !== false &&
        s.slots.length > 0 &&
        s.isAllFilled &&
        !s._autoSubmitted
      ) {
        s._autoSubmitted = true;
        const delay = Math.max(0, Number(getSetting(SETTINGS.autoSubmitDelayMs) ?? 1000));
        setTimeout(() => triggerSubmit(app, root), delay);
      }
    });

    // Tell the dialog to recompute its size so our newly-added panel is visible
    // without the user having to drag the window border.
    requestAnimationFrame(() => {
      try { app.setPosition?.({ height: "auto" }); } catch {}
      // Re-raise the DSN canvas above any z-index changes the dialog re-render
      // may have caused.
      raiseDsnCanvasAboveAll();
    });
  } catch (e) {
    err("UI inject failure", e);
  }
}

function slotsShapeChanged(store, descriptors) {
  if (store.slots.length !== descriptors.length) return true;
  for (let i = 0; i < descriptors.length; i++) {
    if (store.slots[i].faces !== descriptors[i].faces) return true;
  }
  return false;
}

async function renderTrayHTML(app, store) {
  const dsnReady = compat.checkDsn();
  const lockingEnabled = getSetting(SETTINGS.taskDiceLockedByDefault) !== false;
  const isUnlocked = store._unlocked === true;
  // Secret rolls where the current client doesn't get task dice spawn:
  // show a clear banner instead of a confused empty tray.
  const secretSkipped = store._secret === true
    && store._ceremonial !== true
    && (store._spawnedMeshIds?.length ?? 0) === 0;
  const ceremonialGhost = store._ceremonial === true;
  const data = {
    appId: app.appId,
    disabled: !dsnReady,
    secretSkipped,
    ceremonialGhost,
    isEmpty: store.slots.length === 0,
    showSelectAll: store.slots.length > 1, // only useful with 2+ dice
    selectAllTooltip: game.i18n.localize(`${MOD_ID}.tray.selectAllTooltip`),
    selectAllLabel: game.i18n.localize(`${MOD_ID}.tray.selectAll`),
    showAccessToggle: lockingEnabled && store.slots.length > 0,
    accessLocked: !isUnlocked,
    accessIcon: isUnlocked ? "fa-lock-open" : "fa-lock",
    accessTooltip: game.i18n.localize(
      isUnlocked
        ? `${MOD_ID}.tray.lockAccessTooltip`
        : `${MOD_ID}.tray.unlockAccessTooltip`
    ),
    accessLabel: game.i18n.localize(
      isUnlocked
        ? `${MOD_ID}.tray.accessUnlocked`
        : `${MOD_ID}.tray.accessLocked`
    ),
    slots: store.slots.map((s) => ({
      key: s.key,
      faces: s.faces,
      state: s.state,
      value: s.value,
      hidden: s.hidden === true,
      displayValue: s.hidden === true ? "?" : s.value,
      lockIcon: s.state === "locked" ? "fa-lock" : "fa-lock-open",
      lockTooltip: game.i18n.localize(
        s.state === "locked"
          ? `${MOD_ID}.tray.unlock`
          : `${MOD_ID}.tray.lock`
      ),
    })),
  };
  const renderer = foundry?.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  return await renderer(TEMPLATE, data);
}

function bindTrayHandlers(root, store) {
  const tray = root.querySelector(`.dsn-bridge-tray[data-app-id="${store.dialogId}"]`);
  if (!tray) return;

  tray.querySelectorAll('[data-action="dsn-toggle-lock"]').forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      const key = parseInt(ev.currentTarget.dataset.key, 10);
      store.toggleLock(key);
    })
  );

  // Access lock: toggle whether other players can drag/throw the task dice.
  tray.querySelectorAll('[data-action="dsn-toggle-access"]').forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      toggleTaskDiceLock(store);
      store.notify();
    })
  );

  // Select-all: select every task die spawned for this dialog so the user
  // can throw them all in one drag instead of Ctrl+clicking each.
  tray.querySelectorAll('[data-action="dsn-select-all"]').forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      selectAllTaskDice(store);
    })
  );
}

/**
 * Watch the dialog's `<select name="messageMode">`. When the user flips it
 * (e.g. GM changes "Public Roll" to "Blind Roll" before submitting), wipe
 * the spawned task dice + reset secrecy state on the store and re-spawn
 * according to the new mode. This is what lets the ghost-die flow trigger
 * even if the dialog opened with `publicroll` as default.
 */
function bindMessageModeWatcher(root, store, app) {
  const select = root.querySelector('select[name="messageMode"]');
  if (!select) return;
  if (store._modeWatcherBound) return;
  store._modeWatcherBound = true;

  select.addEventListener("change", async () => {
    log("messageMode changed →", select.value, "; re-evaluating spawn");
    try {
      cleanupTaskDiceForStore(store);
      // Reset state so the spawn helper recomputes secrecy.
      delete store._secret;
      delete store._ceremonial;
      // Reset slot values too (a freshly opened mode shouldn't keep stale fills)
      store.slots = store.slots.map((s) => ({
        key: s.key, faces: s.faces, state: "empty", value: null, sourceMeshId: null,
      }));
      delete store._autoSubmitted;
      await spawnTaskDiceForStore(store);
      store.notify();
    } catch (e) {
      err("messageMode change handler failed", e);
    }
  });
}

function triggerSubmit(app, root) {
  try {
    const form = root.querySelector("form.check-modifiers-content");
    const submitBtn = form?.querySelector('button[type=submit]');
    if (!submitBtn) return;
    // Click the actual submit button so PF2e's existing handler runs (it
    // calls preventDefault, sets isResolved/isRolled, calls close()).
    submitBtn.click();
  } catch (e) {
    err("auto-submit failed", e);
  }
}

function unwrap($html) {
  // V1 hooks pass jQuery; v2 pass HTMLElement. Support both.
  if (!$html) return null;
  if ($html instanceof HTMLElement) return $html;
  if ($html.nodeType) return $html;
  if ($html[0] instanceof HTMLElement) return $html[0];
  if (typeof $html.find === "function") return $html[0];
  return null;
}

