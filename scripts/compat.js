import { warn } from "./constants.js";

export const compat = {
  checkLibWrapper() {
    return !!globalThis.libWrapper && typeof libWrapper.register === "function";
  },

  checkPF2e() {
    return game.system?.id === "pf2e";
  },

  // Returns a structured diagnosis so the UI / console can pinpoint *why*
  // persistent dice are unavailable instead of a generic "not active" warning.
  diagnoseDsn() {
    const mod = game.modules.get("dice-so-nice");
    if (!mod?.active) return { ok: false, reason: "moduleMissing" };
    let persistentEnabled, interactivityEnabled;
    try {
      persistentEnabled = game.settings.get("dice-so-nice", "persistentDice");
    } catch { persistentEnabled = undefined; }
    try {
      interactivityEnabled = game.settings.get("dice-so-nice", "allowInteractivity");
    } catch { interactivityEnabled = undefined; }
    if (persistentEnabled === false) return { ok: false, reason: "persistentOff" };
    if (interactivityEnabled === false) return { ok: false, reason: "interactivityOff" };
    // Ground truth: the actual manager has to exist. If both world settings
    // are on but the manager isn't there, the user almost always needs to
    // reload (DSN settings are `requiresReload:true`).
    const dice3d = game.dice3d;
    if (!dice3d?.box?.persistentDiceManager) {
      return { ok: false, reason: "managerMissing" };
    }
    return { ok: true };
  },

  checkDsn() {
    return this.diagnoseDsn().ok;
  },

  isFullyReady() {
    const lw = this.checkLibWrapper();
    const pf2e = this.checkPF2e();
    const diag = this.diagnoseDsn();
    if (!lw) warn("lib-wrapper not active");
    if (!pf2e) warn("not on PF2e system");
    if (!diag.ok) warn(`DSN diagnosis: ${diag.reason} — UI will still render but rolls fall back to RNG`);
    return lw && pf2e && diag.ok;
  },

  getCheckRollClass() {
    return CONFIG.Dice?.rolls?.find?.((c) => c.name === "CheckRoll");
  },

  getDamageRollClass() {
    return CONFIG.Dice?.rolls?.find?.((c) => c.name === "DamageRoll");
  },
};
