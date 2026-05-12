import { MOD_ID, SETTINGS } from "./constants.js";

export function registerSettings() {
  // Register verboseLogging FIRST — log() reads it, and if it's still
  // unregistered when other registrations log debug info, log() bails out.
  game.settings.register(MOD_ID, SETTINGS.verboseLogging, {
    name: `${MOD_ID}.settings.verboseLogging.name`,
    hint: `${MOD_ID}.settings.verboseLogging.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MOD_ID, SETTINGS.enabled, {
    name: `${MOD_ID}.settings.enabled.name`,
    hint: `${MOD_ID}.settings.enabled.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.autoSpawnDice, {
    name: `${MOD_ID}.settings.autoSpawnDice.name`,
    hint: `${MOD_ID}.settings.autoSpawnDice.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.onlyConsumeOwned, {
    name: `${MOD_ID}.settings.onlyConsumeOwned.name`,
    hint: `${MOD_ID}.settings.onlyConsumeOwned.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.hideDecorativeDuringDialog, {
    name: `${MOD_ID}.settings.hideDecorativeDuringDialog.name`,
    hint: `${MOD_ID}.settings.hideDecorativeDuringDialog.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.taskDiceLockedByDefault, {
    name: `${MOD_ID}.settings.taskDiceLockedByDefault.name`,
    hint: `${MOD_ID}.settings.taskDiceLockedByDefault.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.autoSelectAllOnSpawn, {
    name: `${MOD_ID}.settings.autoSelectAllOnSpawn.name`,
    hint: `${MOD_ID}.settings.autoSelectAllOnSpawn.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MOD_ID, SETTINGS.respectSecretRolls, {
    name: `${MOD_ID}.settings.respectSecretRolls.name`,
    hint: `${MOD_ID}.settings.respectSecretRolls.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.suppressDsnThrowMessage, {
    name: `${MOD_ID}.settings.suppressDsnThrowMessage.name`,
    hint: `${MOD_ID}.settings.suppressDsnThrowMessage.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.suppressRedundantDsn, {
    name: `${MOD_ID}.settings.suppressRedundantDsn.name`,
    hint: `${MOD_ID}.settings.suppressRedundantDsn.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.autoSubmitOnFill, {
    name: `${MOD_ID}.settings.autoSubmitOnFill.name`,
    hint: `${MOD_ID}.settings.autoSubmitOnFill.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.settleBufferMs, {
    name: `${MOD_ID}.settings.settleBufferMs.name`,
    hint: `${MOD_ID}.settings.settleBufferMs.hint`,
    scope: "client",
    config: true,
    type: Number,
    default: 100,
    range: { min: 0, max: 1000, step: 50 },
  });

  game.settings.register(MOD_ID, SETTINGS.autoSubmitDelayMs, {
    name: `${MOD_ID}.settings.autoSubmitDelayMs.name`,
    hint: `${MOD_ID}.settings.autoSubmitDelayMs.hint`,
    scope: "client",
    config: true,
    type: Number,
    default: 100,
    range: { min: 0, max: 1000, step: 50 },
  });

  game.settings.register(MOD_ID, SETTINGS.applyToReroll, {
    name: `${MOD_ID}.settings.applyToReroll.name`,
    hint: `${MOD_ID}.settings.applyToReroll.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.requireAllSlots, {
    name: `${MOD_ID}.settings.requireAllSlots.name`,
    hint: `${MOD_ID}.settings.requireAllSlots.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MOD_ID, SETTINGS.rightClickAutoThrow, {
    name: `${MOD_ID}.settings.rightClickAutoThrow.name`,
    hint: `${MOD_ID}.settings.rightClickAutoThrow.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.mirrorThrowToHiddenViewers, {
    name: `${MOD_ID}.settings.mirrorThrowToHiddenViewers.name`,
    hint: `${MOD_ID}.settings.mirrorThrowToHiddenViewers.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.registerPf2eColorsets, {
    name: `${MOD_ID}.settings.registerPf2eColorsets.name`,
    hint: `${MOD_ID}.settings.registerPf2eColorsets.hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.shakeThreshold, {
    name: `${MOD_ID}.settings.shakeThreshold.name`,
    hint: `${MOD_ID}.settings.shakeThreshold.hint`,
    scope: "client",
    config: true,
    type: Number,
    default: 5,
    range: { min: 1, max: 10, step: 1 },
  });

  game.settings.register(MOD_ID, SETTINGS.restrictPlayerPersistentDice, {
    name: `${MOD_ID}.settings.restrictPlayerPersistentDice.name`,
    hint: `${MOD_ID}.settings.restrictPlayerPersistentDice.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD_ID, SETTINGS.rngGuardianMode, {
    name: `${MOD_ID}.settings.rngGuardianMode.name`,
    hint: `${MOD_ID}.settings.rngGuardianMode.hint`,
    scope: "world",
    config: true,
    type: String,
    default: "auto",
    choices: {
      auto: `${MOD_ID}.settings.rngGuardianMode.choices.auto`,
      warn: `${MOD_ID}.settings.rngGuardianMode.choices.warn`,
      off: `${MOD_ID}.settings.rngGuardianMode.choices.off`,
    },
  });
}
