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
    if (getSetting(SETTINGS.suppressRedundantDsn) === false) return;
    try {
      const msg = game.messages.get(messageId);
      if (!msg) return;
      const fromPersistent = (msg.rolls ?? []).some(
        (r) => r?.options?._dsnPersistentSourced === true
      );
      if (fromPersistent) {
        interception.willTrigger3DRoll = false;
        log("suppressed redundant DSN show for message", messageId);
      }
    } catch {}
  });
}
