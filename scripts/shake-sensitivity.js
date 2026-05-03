import { MOD_ID, SETTINGS, log, warn } from "./constants.js";

/**
 * Override DSN's shake-to-throw threshold.
 *
 * DSN's `InputHandler.onMouseMove` accumulates `mouse.shakeCount` (direction
 * reversals) and `mouse.spinAccum` (rotational momentum) while a die is held;
 * it auto-triggers `_activatePreRoll()` when either exceeds a hardcoded 5.
 * Some users find that too stiff — they have to shake vigorously to cross
 * the threshold. This module adds a configurable threshold (1–10) via two
 * prototype patches:
 *
 *   1. `_activatePreRoll` wrap — suppresses early calls. Used to LIMIT the
 *      trigger when the user wants a HIGHER (less sensitive) threshold than
 *      DSN's default 5.
 *
 *   2. `onMouseMove` wrap — after DSN's logic runs, re-checks shake state
 *      against the bridge threshold and manually triggers when met. Used
 *      to FORCE-trigger when the user wants a LOWER (more sensitive)
 *      threshold than DSN's default 5.
 *
 * Both patches go on `InputHandler.prototype` so DSN's box rebuilds (window
 * resize, perf-preset changes) preserve them — same pattern as right-click.
 */

const DEFAULT_THRESHOLD = 5;
const MIN = 1;
const MAX = 10;

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
    Hooks.once("diceSoNiceReady", () => installShakeSensitivity());
    return;
  }
  patch(Object.getPrototypeOf(ih));
  installed = true;
  log("shake-sensitivity: installed (prototype-patched)");
}

function patch(proto) {
  if (!proto || proto._dsnBridgeShakePatched) return;
  proto._dsnBridgeShakePatched = true;

  const origActivate = proto._activatePreRoll;
  const origMove = proto.onMouseMove;

  proto._activatePreRoll = function () {
    const t = getThreshold();
    const sc = this.mouse?.shakeCount ?? 0;
    const sa = Math.abs(this.mouse?.spinAccum ?? 0);
    // Suppress until the bridge threshold is met. DSN's own auto-trigger
    // fires from onMouseMove at >=5; if our threshold is higher, we hold
    // the trigger off until shake state catches up.
    if (sc < t && sa < t) return;
    return origActivate.call(this);
  };

  proto.onMouseMove = async function (event, ndc) {
    const ret = await origMove.call(this, event, ndc);
    // For thresholds LOWER than DSN's hardcoded 5, DSN's automatic check
    // won't have fired yet. Re-evaluate against our threshold and force-
    // trigger via the bound original to bypass our own suppress wrap.
    if (!this.mouse?.preRoll && this.mouse?.heldPersistentDice?.length > 0) {
      const t = getThreshold();
      if (t < DEFAULT_THRESHOLD &&
          (this.mouse.shakeCount >= t || Math.abs(this.mouse.spinAccum) >= t)) {
        origActivate.call(this);
      }
    }
    return ret;
  };
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
               style="flex:1;"
               oninput="this.closest('.dsn-bridge-shake-dialog').querySelector('.dsn-bridge-shake-val').textContent=this.value" />
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

  try {
    const value = await DialogV2.prompt({
      window: { title: i18n("title") },
      content,
      modal: false,
      rejectClose: false,
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
    }
  } catch (e) {
    warn("shake-sensitivity dialog failed", e);
  }
}
