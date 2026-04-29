import { SETTINGS, getSetting, log, warn } from "./constants.js";

/**
 * Right-click on an owned persistent die → throw it in a random direction
 * with the same minimum velocity DSN's `randomMinThrow()` fallback uses.
 * No vigorous shaking required.
 *
 * Implementation: we monkey-patch `inputHandler.onMouseDown` rather than
 * registering a competing window pointerdown listener. DSN's own listener
 * is registered first on `window` capture, so our listener cannot pre-empt
 * it — DSN would still pick up the die (addConstraint), pinning it in the
 * physics world while our throw runs, which causes the die to spin in
 * place instead of flying. Patching the inner `onMouseDown` lets us skip
 * the entire pickup flow when button===2 and call `throwPersistentDice`
 * on a non-constrained die, exactly like DSN's own RandomThrow path.
 *
 * Constants are duplicated here because DSN exposes them only inside the
 * InputHandler module scope. Mirrors `SceneConstants.LEGACY_TO_METERS`.
 */

const LEGACY_TO_METERS = 0.016 / 50;
const MIN_THROW_VELOCITY = 1200 * LEGACY_TO_METERS;
const THROW_LOFT_Y = 2333 * LEGACY_TO_METERS;

/**
 * Build a "dramatic" random throw vector. Speed is sampled in [0.7×, 2.6×]
 * of MIN_THROW_VELOCITY, loft in [0.7×, 1.4×]. Result: every right-click
 * feels like a different toss — sometimes a flick, sometimes a hurl.
 */
function buildRandomVelocity() {
  const angle = Math.random() * Math.PI * 2;
  const speedMult = 0.7 + Math.random() * 1.9;
  const loftMult = 0.7 + Math.random() * 0.7;
  const speed = MIN_THROW_VELOCITY * speedMult;
  return {
    x: Math.cos(angle) * speed,
    y: THROW_LOFT_Y * loftMult,
    z: Math.sin(angle) * speed,
  };
}

let installed = false;

export function installRightClickThrow() {
  if (installed) return;
  const ih = game?.dice3d?.box?.inputHandler;
  if (!ih || typeof ih.onMouseDown !== "function") {
    Hooks.once("diceSoNiceReady", () => installRightClickThrow());
    return;
  }
  patch(ih);
  installContextMenuSuppression();
  installed = true;
  log("right-click-throw: installed");
}

function patch(ih) {
  const orig = ih.onMouseDown.bind(ih);
  ih.onMouseDown = async function (event, ndc) {
    if (event?.button === 2 && getSetting(SETTINGS.rightClickAutoThrow) !== false) {
      const handled = await tryRightClickThrow.call(this, event, ndc);
      // Return value semantics: DSN treats truthy as "captured" and does
      // setPointerCapture; we don't need that for a one-shot throw, so
      // return false either way to keep DSN's outer flow inert.
      return false;
    }
    return orig(event, ndc);
  };
}

function isThrowable(d) {
  if (!d?.userData) return false;
  if (d.userData.persistent !== true) return false;
  if (d.userData.ownerUserId !== game.user?.id) return false;
  if (d.userData.lockedBy && d.userData.lockedBy !== game.user?.id) return false;
  if (d.userData.pendingReplay) return false;
  if (d.persistentThrow) return false;
  return true;
}

async function tryRightClickThrow(event, ndc) {
  // Mirror DSN's onMouseDown setup so findHoveredDie sees fresh cursor pos.
  this.mouse.pos.x = ndc.x;
  this.mouse.pos.y = ndc.y;
  this.hoveredDie = null;
  this.findHoveredDie();
  const hit = this.hoveredDie;
  if (!hit) return false;
  const root = this.findRootObject(hit.object);
  if (!root) return false;
  if (!isThrowable(root)) return false;

  event.preventDefault?.();
  event.stopPropagation?.();

  const pdm = this.persistentDiceManager;
  if (!pdm?.throwPersistentDice) return false;

  // Selection-aware multi-throw: if the hovered die is part of an active
  // multi-selection, throw every selected die in one batch (matching DSN's
  // own left-click grab behavior). Otherwise throw just the hovered die +
  // its d100/d1000 link-group siblings.
  let dice;
  const selectedIds = pdm.selectedPersistentDiceIds;
  if (selectedIds?.size > 0 && selectedIds.has(root.id)) {
    dice = (pdm.getSelectedPersistentDice?.() ?? []).filter(isThrowable);
    if (dice.length === 0) dice = [root];
  } else {
    dice = [root];
    const linkGroupId = root.userData?.linkGroupId;
    if (linkGroupId) {
      const list = pdm.persistentDiceList ?? [];
      for (const m of list) {
        if (m === root) continue;
        if (m?.userData?.linkGroupId === linkGroupId) dice.push(m);
      }
    }
  }

  const velocity = buildRandomVelocity();

  try {
    await pdm.throwPersistentDice(dice, velocity);
    log(`right-click-throw: thrown ${dice.length} die(s)`);
  } catch (e) {
    warn("right-click-throw: pdm.throwPersistentDice threw", e);
  }
  return true;
}

/**
 * Suppress the browser context menu only when the cursor is over a die we
 * could throw. Right-click on empty canvas / chat / sidebar keeps native
 * behavior. This is purely UX polish — the actual throw is dispatched
 * via the patched `onMouseDown`, not from contextmenu.
 */
function installContextMenuSuppression() {
  window.addEventListener(
    "contextmenu",
    (event) => {
      if (getSetting(SETTINGS.rightClickAutoThrow) === false) return;
      const ih = game?.dice3d?.box?.inputHandler;
      if (!ih) return;
      const hit = ih.hoveredDie;
      if (!hit) return;
      const root = ih.findRootObject?.(hit.object);
      if (!root || root.userData?.persistent !== true) return;
      if (root.userData?.ownerUserId !== game.user?.id) return;
      event.preventDefault();
    },
    true
  );
}
