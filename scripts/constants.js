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
  autoSelectAllOnSpawn: "autoSelectAllOnSpawn",
  rightClickAutoThrow: "rightClickAutoThrow",
  mirrorThrowToHiddenViewers: "mirrorThrowToHiddenViewers",
  registerPf2eColorsets: "registerPf2eColorsets",
  shakeThreshold: "shakeThreshold",
  restrictPlayerPersistentDice: "restrictPlayerPersistentDice",
  verboseLogging: "verboseLogging",
};

export const PENDING_TTL_MS = 8000;

// Verbose per-step traces are gated by the verboseLogging client setting.
// warn/err are always on — they signal real problems that operators should see.
const verboseOn = () => {
  try { return game.settings.get(MOD_ID, SETTINGS.verboseLogging) === true; }
  catch { return false; }
};
export const log = (...args) => {
  if (!verboseOn()) return;
  console.log(MOD_PREFIX, ...args);
};
// Per-subsystem tagged logger. Same gating as `log` — emits nothing unless
// the user has flipped verboseLogging on. Use this for any diagnostic that
// needs a more specific prefix than [PF2e×DSN] (shake, right-click,
// visibility, ephemeral-mirror, flavor sync, etc.).
export const tagged = (tag) => (...args) => {
  if (!verboseOn()) return;
  console.log(tag, ...args);
};
export const warn = (...args) => console.warn(MOD_PREFIX, ...args);
export const err = (...args) => console.error(MOD_PREFIX, ...args);

export const getSetting = (key) => {
  try { return game.settings.get(MOD_ID, key); }
  catch { return undefined; }
};

export const isEnabled = () => getSetting(SETTINGS.enabled) !== false;
