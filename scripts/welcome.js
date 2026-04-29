import { MOD_ID, log, warn } from "./constants.js";

/**
 * Self-whispered welcome message, sent once per major-feature version so
 * users learn what the module does without having to dig into settings.
 *
 * Version-keyed flag: when we add a meaningfully different feature in a
 * future release we bump WELCOME_VERSION and the message re-sends to
 * everyone, even users who saw the old one. Within the same version we
 * never re-send.
 *
 * Whisper to self (`whisper: [game.user.id]`) keeps the table chat quiet
 * — every player gets the message independently the first time they
 * load the module.
 */

const FLAG_KEY = "welcomeShownVersion";
const WELCOME_VERSION = "0.2.5";

export async function maybeShowWelcome() {
  if (!game.user) return;
  let shown;
  try {
    shown = game.user.getFlag(MOD_ID, FLAG_KEY);
  } catch {
    return;
  }
  if (shown === WELCOME_VERSION) return;

  const title = game.i18n.localize(`${MOD_ID}.welcome.title`);
  const body = game.i18n.localize(`${MOD_ID}.welcome.body`);
  const content = `<section class="dsn-bridge-welcome"><h3 style="margin-top:0">${title}</h3>${body}</section>`;

  try {
    await ChatMessage.create({
      user: game.user.id,
      speaker: { alias: "PF2e × DSN Bridge" },
      content,
      whisper: [game.user.id],
    });
    await game.user.setFlag(MOD_ID, FLAG_KEY, WELCOME_VERSION);
    log(`welcome message sent (version ${WELCOME_VERSION})`);
  } catch (e) {
    warn("welcome: send failed", e);
  }
}
