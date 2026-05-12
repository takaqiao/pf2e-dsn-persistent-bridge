import { MOD_ID, SETTINGS, getSetting, log, warn } from "./constants.js";

/**
 * Auto-handle conflicts with the "RNG Guardian" module.
 *
 * Guardian (https://github.com/7H3LaughingMan/rng-guardian) replaces
 * Foundry's dice term classes with PCG-seeded subclasses, records the seed
 * on each `Roll.evaluate`, and verifies via socket that published chat
 * dice match the seed. Any mismatch → GM warning that the roll was
 * altered.
 *
 * The bridge deliberately injects predetermined values into PF2e roll
 * evaluations (via `Die._roll` swap), which causes Guardian to flag every
 * bridge-managed roll as "altered". Result: GM gets a continuous stream of
 * false-positive cheat warnings.
 *
 * Guardian provides a world-scoped `ignoredRolls` array setting (a list of
 * Roll class names that Guardian skips during verification). Adding
 * `CheckRoll` + `DamageRoll` to that list resolves the conflict cleanly.
 *
 * This module checks Guardian's presence at `ready` and (depending on the
 * GM-set `rngGuardianMode`):
 *   - `auto` (default) — silently appends CheckRoll/DamageRoll to
 *     Guardian's `ignoredRolls`. Only the GM can do this (world setting).
 *   - `warn` — shows a one-time `ui.notifications.warn` telling the GM
 *     to configure Guardian's ignore list manually.
 *   - `off` — do nothing (user has decided to live with the warnings).
 */

const GUARDIAN_ID = "rng-guardian";
const GUARDIAN_SETTING = "ignoredRolls";
// PF2e roll classes the bridge injects into. Keep these names in sync
// with the libWrapper targets in `evaluate-wrapper.js`.
const PF2E_ROLL_CLASSES = ["CheckRoll", "DamageRoll"];

export async function checkAndConfigureGuardian() {
  const guardian = game.modules.get(GUARDIAN_ID);
  if (!guardian?.active) return;

  const mode = getSetting(SETTINGS.rngGuardianMode) ?? "auto";
  if (mode === "off") {
    log("Guardian compat: skipped (rngGuardianMode=off)");
    return;
  }

  // The `ignoredRolls` setting is world-scoped — only GM can write it.
  // Non-GM clients still benefit (the setting is shared) but can't act.
  if (!game.user?.isGM) {
    log("Guardian compat: detected but not GM, skipping action");
    return;
  }

  let ignored;
  try {
    ignored = game.settings.get(GUARDIAN_ID, GUARDIAN_SETTING) ?? [];
  } catch (e) {
    warn("Guardian compat: cannot read ignoredRolls setting (Guardian may not have registered yet)", e);
    return;
  }
  if (!Array.isArray(ignored)) ignored = [];

  const missing = PF2E_ROLL_CLASSES.filter((c) => !ignored.includes(c));
  if (missing.length === 0) {
    log("Guardian compat: CheckRoll + DamageRoll already in Guardian's ignore list");
    return;
  }

  if (mode === "warn") {
    ui.notifications?.warn?.(
      game.i18n.format(`${MOD_ID}.rngGuardian.warn`, { rolls: missing.join(", ") }),
      { permanent: false }
    );
    log(`Guardian compat: warning shown — ignoredRolls missing ${missing.join(", ")}`);
    return;
  }

  // mode === "auto" — append the missing classes
  try {
    const updated = [...ignored, ...missing];
    await game.settings.set(GUARDIAN_ID, GUARDIAN_SETTING, updated);
    ui.notifications?.info?.(
      game.i18n.format(`${MOD_ID}.rngGuardian.autoConfigured`, { rolls: missing.join(", ") })
    );
    log(`Guardian compat: auto-added to ignoredRolls — ${missing.join(", ")}`);
  } catch (e) {
    warn("Guardian compat: failed to update ignoredRolls", e);
  }
}
