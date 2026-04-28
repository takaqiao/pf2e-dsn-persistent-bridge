export const MOD_ID = "pf2e-dsn-persistent-bridge";
export const MOD_PREFIX = "[PF2e×DSN]";

export const SETTINGS = {
  enabled: "enabled",
  requireAllSlots: "requireAllSlots",
  applyToReroll: "applyToReroll",
  autoSubmitOnFill: "autoSubmitOnFill",
  autoSubmitDelayMs: "autoSubmitDelayMs",
  suppressRedundantDsn: "suppressRedundantDsn",
  autoSpawnDice: "autoSpawnDice",
  onlyConsumeOwned: "onlyConsumeOwned",
  hideDecorativeDuringDialog: "hideDecorativeDuringDialog",
  settleBufferMs: "settleBufferMs",
  suppressDsnThrowMessage: "suppressDsnThrowMessage",
  taskDiceLockedByDefault: "taskDiceLockedByDefault",
  respectSecretRolls: "respectSecretRolls",
};

export const PENDING_TTL_MS = 8000;

export const log = (...args) => console.log(MOD_PREFIX, ...args);
export const warn = (...args) => console.warn(MOD_PREFIX, ...args);
export const err = (...args) => console.error(MOD_PREFIX, ...args);

export const getSetting = (key) => {
  try { return game.settings.get(MOD_ID, key); }
  catch { return undefined; }
};

export const isEnabled = () => getSetting(SETTINGS.enabled) !== false;
