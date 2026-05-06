import { MOD_ID, SETTINGS, tagged, warn } from "./constants.js";

/**
 * Override DSN's shake-to-throw threshold.
 *
 * DSN's `InputHandler.onMouseMove` records held-die mouse positions to
 * `mouse.dragPositions` (sampled every 40ms, max 6 entries) and accumulates
 * `mouse.shakeCount` (direction reversals via dot-product < -0.5) and
 * `mouse.spinAccum` (rotational momentum via cross-product). It auto-fires
 * `_activatePreRoll()` when either reaches a hardcoded `m=5` / `g=5`.
 *
 * The shake-reversal heuristic only triggers on back-and-forth motion — a
 * straight unidirectional flick (the natural "throw" gesture for many
 * users) NEVER reaches the trigger no matter how vigorous, because there's
 * no direction reversal. So lowering the threshold alone has no effect on
 * straight-flick throws.
 *
 * Four prototype patches together make the threshold actually do what the
 * user expects:
 *
 *   1. `_activatePreRoll` wrap — for thresholds HIGHER than 5, suppress
 *      DSN's stock auto-trigger until shakeCount/spinAccum catch up.
 *
 *   2. `onMouseMove` shake-path — for thresholds LOWER than 5, manually
 *      fire when shakeCount/spinAccum hit our (lower) bar before DSN's
 *      hardcoded 5 would.
 *
 *   3. `onMouseMove` velocity-path — for thresholds LOWER than 5, also
 *      fire on a fast unidirectional segment (read straight from
 *      `mouse.dragPositions`). Catches a clean throw flick mid-drag.
 *
 *   4. `onMouseUp` mouseup-catchall — natural human gesture is "wind up
 *      briefly, then release"; users don't keep dragging until the move
 *      heuristic trips. On release, if held dice had any non-trivial
 *      motion during the hold, fire `_activatePreRoll` BEFORE DSN's
 *      onMouseUp checks `mouse.preRoll`. DSN's own `_computeThrowVelocity`
 *      then reads the recent `dragPositions` and produces a directed
 *      throw (random fallback if too few samples).
 *
 * All patches go on `Object.getPrototypeOf(ih)` (i.e., `InputHandler.prototype`)
 * so DSN's box rebuilds (window resize, perf-preset changes) preserve them.
 * Same survival pattern as the v0.3.1 right-click fix.
 */

const DEFAULT_THRESHOLD = 5;
const MIN = 1;
const MAX = 10;

// Diagnostic logger — gated by the verboseLogging setting (see constants.js).
// Every shake-related event uses this prefix so users filing a bug report
// can grep their console paste for `[PF2e×DSN shake]` after flipping the
// verbose setting on.
const DIAG = tagged("[PF2e×DSN shake]");

let installed = false;

function getThreshold() {
  try {
    const v = game.settings.get(MOD_ID, SETTINGS.shakeThreshold);
    if (!Number.isFinite(v)) return DEFAULT_THRESHOLD;
    return Math.max(MIN, Math.min(MAX, Math.round(v)));
  } catch {
    return DEFAULT_THRESHOLD;
  }
}

export function installShakeSensitivity() {
  if (installed) return;
  const ih = game?.dice3d?.box?.inputHandler;
  if (!ih?.onMouseMove || !ih?._activatePreRoll) {
    DIAG("install deferred — InputHandler not ready, waiting for diceSoNiceReady");
    Hooks.once("diceSoNiceReady", () => installShakeSensitivity());
    return;
  }
  patch(Object.getPrototypeOf(ih));
  installed = true;
}

function patch(proto) {
  if (!proto || proto._dsnBridgeShakePatched) {
    DIAG("patch skipped — already patched on this prototype");
    return;
  }
  proto._dsnBridgeShakePatched = true;

  const origActivate = proto._activatePreRoll;
  const origMove = proto.onMouseMove;
  const origMouseUp = proto.onMouseUp;

  proto._activatePreRoll = function () {
    const t = getThreshold();
    const sc = this.mouse?.shakeCount ?? 0;
    const sa = Math.abs(this.mouse?.spinAccum ?? 0);
    if (t > DEFAULT_THRESHOLD && sc < t && sa < t) {
      // Higher threshold: hold off DSN's auto-trigger until our bar is met.
      DIAG(`_activatePreRoll suppressed (threshold=${t}, sc=${sc}, |sa|=${sa.toFixed(2)})`);
      return;
    }
    return origActivate.call(this);
  };

  proto.onMouseMove = async function (event, ndc) {
    const ret = await origMove.call(this, event, ndc);

    if (this.mouse?.preRoll || !(this.mouse?.heldPersistentDice?.length > 0)) {
      return ret;
    }
    const t = getThreshold();
    if (t >= DEFAULT_THRESHOLD) return ret;

    // Shake-path: reversal/rotation came in below DSN's hardcoded 5 but
    // already above our (lower) bar. Fire via the captured original to
    // bypass our own suppress wrap.
    const sc = this.mouse.shakeCount;
    const sa = Math.abs(this.mouse.spinAccum);
    if (sc >= t || sa >= t) {
      DIAG(`force-trigger via shake (threshold=${t}, sc=${sc}, |sa|=${sa.toFixed(2)})`);
      origActivate.call(this);
      return ret;
    }

    // Velocity-path: catch a clean unidirectional flick. DSN's reversal
    // heuristic never fires on a straight throw — read the most recent
    // segment distance from dragPositions instead. Linear scale so t=1
    // fires on essentially any motion, t=4 ≈ DSN's own So=12 floor.
    const dp = this.mouse.dragPositions;
    if (dp?.length >= 2) {
      const a = dp[dp.length - 2];
      const b = dp[dp.length - 1];
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      const minSegment = Math.max(0.5, (t - 1) * 2);
      if (dist >= minSegment) {
        DIAG(`force-trigger via velocity (threshold=${t}, segDist=${dist.toFixed(1)} ≥ ${minSegment})`);
        origActivate.call(this);
      }
    }
    return ret;
  };

  proto.onMouseUp = async function (event) {
    const m = this.mouse;
    // Mouseup-catchall: human reflex is to release after a brief wind-up,
    // not to drag until the move heuristic trips. `dragPositions` is also
    // throttled to 40ms samples — fast flicks routinely fall between two
    // samples, leaving us with a `path` that doesn't reflect the actual
    // gesture. So we lean on the threshold itself: at t=1 any drag-with-
    // release fires preRoll. DSN's `_computeThrowVelocity(true)` then
    // either uses whatever samples exist (>=3 → directed throw) or falls
    // back to randomMinThrow (random direction, fixed min velocity) —
    // both are vastly better than the silent drop.
    //
    // Pure click-without-drag goes through DSN's pendingGrab/selection
    // path before reaching here (constraintDown stays false in that
    // case), so this catchall only fires for genuine drags.
    if (m && !m.preRoll && m.constraintDown && m.heldPersistentDice?.length > 0) {
      const t = getThreshold();
      if (t < DEFAULT_THRESHOLD) {
        const sc = m.shakeCount ?? 0;
        const sa = Math.abs(m.spinAccum ?? 0);
        const dp = m.dragPositions;
        let totalPath = 0;
        if (dp?.length >= 2) {
          for (let k = 1; k < dp.length; k++) {
            totalPath += Math.hypot(dp[k].x - dp[k - 1].x, dp[k].z - dp[k - 1].z);
          }
        }
        // Linear scale: t=1 → 0 (any drag fires), t=4 → 6 (deliberate
        // motion required). `t=5` is unreachable here (gated above).
        const minPath = (t - 1) * 2;
        const intent = sc > 0 || sa > 0.1 || totalPath >= minPath;
        if (intent) {
          DIAG(`force-trigger via mouseup (threshold=${t}, sc=${sc}, |sa|=${sa.toFixed(2)}, path=${totalPath.toFixed(1)} ≥ ${minPath})`);
          origActivate.call(this);
        } else {
          DIAG(`mouseup: no throw intent (threshold=${t}, sc=${sc}, |sa|=${sa.toFixed(2)}, path=${totalPath.toFixed(1)} < ${minPath})`);
        }
      }
    } else if (m?.preRoll) {
      DIAG("mouseup: preRoll already set (DSN will throw via its own path)");
    }
    return origMouseUp.call(this, event);
  };

  DIAG("patches installed on InputHandler.prototype (default threshold=" + getThreshold() + ")");
}

/**
 * Open the slot-tray's Shake-sensitivity popup with a slider 1–10. Saves
 * the chosen threshold to `shakeThreshold` setting on click of "Save".
 */
export async function openShakeSensitivityDialog() {
  const current = getThreshold();
  const i18n = (key, data) => data
    ? game.i18n.format(`${MOD_ID}.shakeSensitivity.${key}`, data)
    : game.i18n.localize(`${MOD_ID}.shakeSensitivity.${key}`);

  const content = `
    <div class="dsn-bridge-shake-dialog" style="padding:8px;">
      <p style="margin:0 0 12px;">${i18n("dialogIntro")}</p>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <span style="min-width:5em;">${i18n("threshold")}:</span>
        <input name="threshold" type="range" min="${MIN}" max="${MAX}" value="${current}" step="1"
               style="flex:1;" />
        <strong class="dsn-bridge-shake-val" style="min-width:1.5em;text-align:right;font-size:1.1em;">${current}</strong>
      </div>
      <p style="font-size:0.85em;color:#888;margin:8px 0 0;">${i18n("hint")}</p>
    </div>
  `;

  const DialogV2 = foundry?.applications?.api?.DialogV2;
  if (!DialogV2) {
    warn("shake-sensitivity: DialogV2 unavailable");
    return;
  }

  // Inline `oninput` is silently dropped under FVTT's CSP; bind via the render
  // callback so the live numeric display next to the slider updates as the
  // user drags.
  const wireLiveDisplay = (root) => {
    if (!root?.querySelector) return;
    const slider = root.querySelector('input[name="threshold"]');
    const display = root.querySelector(".dsn-bridge-shake-val");
    if (!slider || !display || slider._dsnBridgeWired) return;
    slider._dsnBridgeWired = true;
    slider.addEventListener("input", () => { display.textContent = slider.value; });
  };

  try {
    const value = await DialogV2.prompt({
      window: { title: i18n("title") },
      content,
      modal: false,
      rejectClose: false,
      render: (_event, dialog) => {
        const root = dialog?.element ?? dialog;
        wireLiveDisplay(root);
      },
      ok: {
        label: i18n("save"),
        icon: "fa-solid fa-floppy-disk",
        callback: (event, button) => {
          const slider = button?.form?.elements?.threshold;
          const v = slider ? parseInt(slider.value, 10) : NaN;
          return Number.isFinite(v) ? v : null;
        },
      },
    });
    if (Number.isFinite(value)) {
      await game.settings.set(MOD_ID, SETTINGS.shakeThreshold, value);
      ui.notifications?.info?.(i18n("saved", { value }));
      DIAG(`threshold saved → ${value} (live; no reload required)`);
    }
  } catch (e) {
    warn("shake-sensitivity dialog failed", e);
  }
}
