import { SETTINGS, getSetting, log, warn } from "./constants.js";
import { dispatchDie, ownerEligible } from "./matcher.js";
import { SlotRegistry } from "./slot-store.js";

const DEFAULT_AUTO_SUBMIT_DELAY_MS = 100;

const DEFAULT_SETTLE_BUFFER_MS = 3500;

/**
 * Watch DSN's persistent dice for newly-resolved results.
 *
 * Important: `dice-so-nice.persistentDiceChanged` ONLY fires on add/remove,
 * NOT when an existing mesh's `.result` flips from null→number after a throw.
 * So we additionally:
 *   - poll the list at ~4 Hz while any SlotStore is open (cheap, zero cost otherwise)
 *   - hook `diceSoNiceRollComplete` for an immediate scan when DSN signals a roll finished
 *
 * `dsnPF2eBridge_consumed` flag on userData de-dupes accepted dice.
 */


export function startDsnListener() {
  // Two hooks for DSN persistent-throw chat messages:
  //
  //  1. preCreateChatMessage: intercepts BEFORE the message hits the DB.
  //     If a roll dialog is open and `suppressDsnThrowMessage` is on, we
  //     return false to cancel the message entirely (the user already sees
  //     the dice roll visually + will see the PF2e check result, so the
  //     standalone DSN message would be redundant). We still trigger the
  //     settle flow to fill the slot.
  //
  //  2. createChatMessage: only runs when the message wasn't suppressed
  //     above. Used for two cases:
  //       - standalone persistent throws (no dialog open) — just react.
  //       - suppression off — let the message exist, but hide its DOM via
  //         DSN's own `_dice3danimating` mechanism until settle completes.
  //
  // We do NOT use `persistentDiceChanged` or polling: those fire while the
  // physics is still running and `forcedResult` is already set on the mesh,
  // which would let the slot fill the instant the user releases the die —
  // well before the visible roll completes.
  Hooks.on("preCreateChatMessage", onPreCreateChatMessage);
  Hooks.on("createChatMessage", onChatMessage);

  if (!game.dice3d) {
    Hooks.once("diceSoNiceReady", () => {
      log("DSN ready");
    });
    warn("DSN not yet ready");
    return;
  }
  log("DSN persistent dice listener active");
}

function onPreCreateChatMessage(message, data /*, options, userId */) {
  try {
    const isPersistentThrow = !!data?.flags?.["dice-so-nice"]?.persistent;
    if (!isPersistentThrow) return;

    const dialogOpen = SlotRegistry.all().length > 0;
    const suppress = getSetting(SETTINGS.suppressDsnThrowMessage) !== false && dialogOpen;
    if (!suppress) return; // let createChatMessage handle it

    // Suppression path: cancel the message creation, but still feed the slot.
    // This is the user's preferred behavior: when a roll dialog is open the
    // DSN throw message is redundant noise — the dice are visibly thrown on
    // canvas and the PF2e check message that follows already contains the
    // result.
    log("suppressing redundant DSN persistent-throw message (dialog open)");
    clearConsumedFlags();
    settleAndScan().catch((e) => warn("settleAndScan failed", e));
    return false; // cancel ChatMessage creation
  } catch (e) {
    warn("preCreateChatMessage handler failed", e);
  }
}

function clearConsumedFlags() {
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return;
  for (const m of list) {
    if (m?.userData) m.userData.dsnPF2eBridge_consumed = false;
  }
}

/**
 * Called for every newly-created chat message. If it's a DSN persistent throw
 * message we:
 *
 *   1) Borrow DSN's own ephemeral-roll hide mechanism: set
 *      `message._dice3danimating = true`. DSN's `renderChatMessageHTML` hook
 *      checks this and applies the `.dsn-hide` class to the rendered DOM,
 *      keeping the message invisible. This is how DSN already keeps regular
 *      `/roll` messages hidden until the dice land — we're just extending it
 *      to persistent throws (which DSN deliberately leaves out of intercept).
 *
 *   2) Wait for the throw to fully settle (engine.rolling false + per-mesh
 *      `persistentThrow` deletion + user-tunable buffer).
 *
 *   3) Reveal the message by removing the flags and stripping `.dsn-hide`
 *      from the DOM, then dispatch the result to the slot panel.
 *
 * If the user has DSN's `immediatelyDisplayChatMessages` setting enabled, we
 * respect that and skip the hide step (the slot still settles with delay).
 */
function onChatMessage(message) {
  try {
    const isPersistentThrow = !!message?.flags?.["dice-so-nice"]?.persistent;
    if (!isPersistentThrow) return;

    // Clear consumed flags so the re-thrown dice on canvas are re-captured.
    clearConsumedFlags();

    let hidden = false;
    try {
      const immediate = game.settings.get("dice-so-nice", "immediatelyDisplayChatMessages");
      if (immediate === false) {
        // Borrow DSN's flag — its own renderChatMessageHTML hook will hide the DOM.
        message._dice3danimating = true;
        message._dice3dPendingRenders = (message._dice3dPendingRenders || 0) + 1;
        hidden = true;
      }
    } catch {}

    settleAndReveal(message, hidden);
  } catch {}
}

async function settleAndReveal(message, hidden) {
  await settleAndScan(); // wait for visual completion + buffer, then fill slot

  if (hidden) {
    try {
      delete message._dice3danimating;
      delete message._dice3dPendingRenders;
      delete message._dice3dMessageHidden;
      // Strip dsn-hide from the rendered message DOM (main chat + popout).
      const id = message?.id;
      if (id) {
        const selectors = [
          `#chat-log .message[data-message-id="${id}"]`,
          `#chat-popout .message[data-message-id="${id}"]`,
          `[data-message-id="${id}"]`,
        ];
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => {
            el.classList.remove("dsn-hide");
            el.querySelectorAll(".dsn-hide").forEach((c) => c.classList.remove("dsn-hide"));
          });
        }
        // Scroll the chat to the new message in case it was anchored at bottom.
        try { window.ui?.chat?.scrollBottom?.({ popout: false }); } catch {}
      }
    } catch (e) {
      warn("reveal persistent message failed", e);
    }
  }
}

const SETTLE_POLL_MS = 50;
const SETTLE_TIMEOUT_MS = 5000;

async function settleAndScan() {
  const t0 = performance.now();
  const box = game.dice3d?.box;
  const engine = box?.throwEngine;

  const initialState = {
    "engine.rolling": engine?.rolling,
    "engine.running": engine?.running,
    "box.rolling": box?.rolling,
    persistentThrowCount: (box?.persistentDiceList ?? []).filter((m) => m?.persistentThrow).length,
    forcedResults: (box?.persistentDiceList ?? []).map((m) => m?.forcedResult),
  };

  if (box && (engine?.rolling || box.rolling)) {
    const start = Date.now();
    while ((engine?.rolling || box.rolling) && Date.now() - start < SETTLE_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
    }
  }
  const t1 = performance.now();

  const list = box?.persistentDiceList;
  if (Array.isArray(list)) {
    const start = Date.now();
    while (list.some((m) => m?.persistentThrow) && Date.now() - start < SETTLE_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
    }
  }
  const t2 = performance.now();

  const buffer = Math.max(0, Number(getSetting(SETTINGS.settleBufferMs) ?? DEFAULT_SETTLE_BUFFER_MS));
  await new Promise((r) => setTimeout(r, buffer));
  const t3 = performance.now();

  log("settleAndScan timing:", {
    initialState,
    waitedForRolling: `${(t1 - t0).toFixed(0)}ms`,
    waitedForPersistentThrow: `${(t2 - t1).toFixed(0)}ms`,
    waitedForBuffer: `${(t3 - t2).toFixed(0)}ms (configured ${buffer}ms)`,
    total: `${(t3 - t0).toFixed(0)}ms`,
    settingValue: getSetting(SETTINGS.settleBufferMs),
  });

  scanList();
}

function scanList() {
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return;
  for (const mesh of list) handleMesh(mesh);
}

function handleMesh(mesh) {
  if (!mesh) return;
  // DSN stores the result of a thrown persistent die on `forcedResult`, not on
  // `result` (which is only used transiently during physics simulation and
  // reset to null after settling — see ThrowEngine.js line 499).
  const raw = mesh.forcedResult;
  if (raw == null) return;
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  if (mesh.userData?.dsnPF2eBridge_consumed) return;
  // d100 in DSN is two linked d10 meshes (tens + units). We only consume primaries.
  if (mesh.userData?.linkGroupSecondary === true) return;

  // (Ceremonial dice are now also tagged `owned` and feed PF2e through the
  // normal slot pipeline. The player's slot tray hides the value via
  // store._hideValues, so even though the value flows through internally
  // it is never painted to the player's UI.)

  // Owned-only gate: only meshes the module spawned and tagged as `owned`
  // feed into the slot pipeline. Decorative dice + secret mirrors on
  // observers are skipped.
  if (getSetting(SETTINGS.onlyConsumeOwned) !== false) {
    if (mesh.userData?.dsnPF2eBridge_owned !== true) return;
  }
  // NOTE: we previously gated on `mesh.stopped > 0` to delay capture until the
  // physics settled visually, but DSN never assigns that field anywhere it
  // becomes truthy (it's only ever initialized to 0). Capture is now driven by
  // the createChatMessage hook (which DSN posts right after the throw lands)
  // plus the 250ms poll — so visual sync is achieved through hook timing, not
  // a per-mesh flag.

  const ownerUserId = mesh.userData?.ownerUserId;
  if (!ownerEligible(ownerUserId)) return;

  // For composite (d100) dice, the primary mesh has notation.compositeType="d100"
  // and notation.compositeResult holds the 1..100 combined value, while
  // forcedResult holds only this digit's face. Prefer the composite values.
  const compositeType = mesh.notation?.compositeType;
  const compositeValue = mesh.notation?.compositeResult;
  const faces = parseFaces(compositeType ?? mesh.notation?.type);
  if (!faces) return;
  const finalValue = Number.isFinite(compositeValue) ? compositeValue : value;

  const die = {
    faces,
    value: finalValue,
    ownerUserId,
    meshId: mesh.userData?.persistentId,
  };

  const consumed = dispatchDie(die);
  if (consumed) {
    if (mesh.userData) mesh.userData.dsnPF2eBridge_consumed = true;
  }
}

function parseFaces(notationType) {
  if (typeof notationType !== "string") return null;
  const m = /^d(\d+)$/i.exec(notationType.trim());
  return m ? parseInt(m[1], 10) : null;
}

