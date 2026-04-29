import { SETTINGS, getSetting, log } from "./constants.js";

/**
 * Stop DSN from animating a chat message whose Rolls were already produced
 * from the persistent dice the user just physically threw on the canvas.
 *
 * DSN exposes `diceSoNiceMessagePreProcess(messageId, interception)` exactly
 * for this kind of case (see DSN module/main.js shouldInterceptMessage).
 */
export function registerDsnSuppressor() {
  Hooks.on("diceSoNiceMessagePreProcess", (messageId, interception) => {
    if (getSetting(SETTINGS.suppressRedundantDsn) === false) {
      log("suppressor: skipped (setting off) for message", messageId);
      return;
    }
    try {
      const msg = game.messages.get(messageId);
      if (!msg) {
        log("suppressor: no message found for id", messageId);
        return;
      }
      const rolls = msg.rolls ?? [];
      const fromPersistent = rolls.some(
        (r) => r?.options?._dsnPersistentSourced === true
      );
      if (fromPersistent) {
        interception.willTrigger3DRoll = false;
        log("suppressor: suppressed redundant DSN show for message", messageId);
      } else {
        // This log fires when DSN is about to animate a roll that did NOT
        // come through our wrapper. If you see this immediately after a
        // dialog auto-submit, the wrapper isn't running (lib-wrapper missing
        // / disabled, or PF2e Roll class not found).
        log("suppressor: not from persistent — DSN will animate", {
          messageId,
          rollCount: rolls.length,
          rollOptions: rolls.map((r) => Object.keys(r?.options ?? {})),
        });
      }
    } catch (e) {
      log("suppressor: error", e);
    }
  });
}
