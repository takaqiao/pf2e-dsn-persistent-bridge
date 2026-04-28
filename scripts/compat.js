import { warn } from "./constants.js";

export const compat = {
  checkLibWrapper() {
    return !!globalThis.libWrapper && typeof libWrapper.register === "function";
  },

  checkPF2e() {
    return game.system?.id === "pf2e";
  },

  checkDsn() {
    const mod = game.modules.get("dice-so-nice");
    if (!mod?.active) return false;
    try {
      const persistentEnabled = game.settings.get("dice-so-nice", "persistentDice");
      const interactivityEnabled = game.settings.get("dice-so-nice", "allowInteractivity");
      return persistentEnabled !== false && interactivityEnabled !== false;
    } catch {
      return false;
    }
  },

  isFullyReady() {
    const lw = this.checkLibWrapper();
    const pf2e = this.checkPF2e();
    const dsn = this.checkDsn();
    if (!lw) warn("lib-wrapper not active");
    if (!pf2e) warn("not on PF2e system");
    if (!dsn) warn("DSN not active or persistent dice disabled — UI will still render but rolls fall back to RNG");
    return lw && pf2e && dsn;
  },

  getCheckRollClass() {
    return CONFIG.Dice?.rolls?.find?.((c) => c.name === "CheckRoll");
  },

  getDamageRollClass() {
    return CONFIG.Dice?.rolls?.find?.((c) => c.name === "DamageRoll");
  },
};
