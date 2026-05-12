import { MOD_ID, log, warn } from "./constants.js";

/**
 * DSN bundles every per-client preference into a single user flag at
 * `dice-so-nice.settings`. Most fields (image / shadow / hi-DPI / bump)
 * are `requiresReload`-class — DSN reads them once at scene init and
 * caches them on its renderer.
 *
 * We expose a 3-step preset (low/medium/high) on the tray as a convenience
 * over going to Settings → DSN → Performance. The preset writes a coherent
 * bundle of fields and toasts the user to F5.
 *
 * Preset profiles mirror DSN's own `core.performanceMode` mapping (see the
 * preset switch in DSN's main.js) so a low/medium/high we set produces the
 * same visual look DSN would produce when initializing fresh on each
 * Foundry performanceMode level.
 */

const PRESET_NAMES = ["low", "medium", "high"];

/**
 * DSN's High preset picks antialiasing based on the WebGL version of the
 * current renderer: WebGL2 → "msaa" (hardware multi-sample), else "smaa"
 * (shader-based fallback). Replicating that detection keeps our preset
 * byte-identical to what DSN's own initialization would write at
 * core.performanceMode=2/3.
 */
function detectHighAntialiasing() {
  try {
    const ctx = game?.canvas?.app?.renderer?.context;
    return ctx?.webGLVersion === 2 ? "msaa" : "smaa";
  } catch {
    return "smaa";
  }
}

function buildPresetProfile(name) {
  switch (name) {
    case "low":
      return {
        imageQuality: "low",
        shadowQuality: "low",
        bumpMapping: false,
        useHighDPI: false,
        antialiasing: "none",
        glow: false,
        persistentDiceOutlines: false,
        advancedGlass: false,
      };
    case "medium":
      return {
        imageQuality: "medium",
        shadowQuality: "low",
        bumpMapping: true,
        useHighDPI: false,
        antialiasing: "none",
        glow: false,
        persistentDiceOutlines: false,
        advancedGlass: false,
      };
    case "high":
      return {
        imageQuality: "high",
        shadowQuality: "high",
        bumpMapping: true,
        useHighDPI: true,
        antialiasing: detectHighAntialiasing(),
        glow: true,
        persistentDiceOutlines: true,
        advancedGlass: true,
      };
    default:
      return null;
  }
}

function readDsnSettingsFlag() {
  try {
    return game.user?.getFlag("dice-so-nice", "settings") ?? null;
  } catch {
    return null;
  }
}

/**
 * Read DSN's *effective* settings, not just the user flag.
 *
 * Why: DSN.CONFIG() is `mergeObject(DEFAULT_OPTIONS, userFlag)`. DEFAULT_OPTIONS
 * itself populates the perf fields from `core.performanceMode` via DSN's own
 * switch case 0/1/2/3. A user who never touched DSN's Performance tab has
 * an empty flag — but DSN is still rendering at the perf-mode-derived level.
 * Reading the flag alone would incorrectly report "custom" for that user.
 *
 * Using `Dice3D.CONFIG()` returns the merged result, so our preset
 * detection sees the same values DSN actually uses to render.
 */
function readEffectiveSettings() {
  try {
    const Dice3DCls = game?.dice3d?.constructor;
    if (Dice3DCls?.CONFIG) return Dice3DCls.CONFIG();
  } catch {}
  return readDsnSettingsFlag();
}

export function getCurrentPreset() {
  const settings = readEffectiveSettings();
  if (!settings) return null;
  for (const name of PRESET_NAMES) {
    const p = buildPresetProfile(name);
    if (
      settings.imageQuality === p.imageQuality &&
      settings.shadowQuality === p.shadowQuality &&
      !!settings.bumpMapping === p.bumpMapping &&
      !!settings.useHighDPI === p.useHighDPI
    ) {
      return name;
    }
  }
  return "custom";
}

export async function cyclePerfPreset() {
  const cur = getCurrentPreset();
  // "custom" → next becomes low (start of cycle); else step forward.
  const idx = PRESET_NAMES.indexOf(cur);
  const next = PRESET_NAMES[(idx + 1) % PRESET_NAMES.length];
  await applyPreset(next);
  return next;
}

async function applyPreset(name) {
  const profile = buildPresetProfile(name);
  if (!profile) {
    warn(`applyPreset: unknown preset ${name}`);
    return;
  }
  if (!game.user) return;
  const cur = readDsnSettingsFlag() ?? {};
  const merged = { ...cur, ...profile };
  try {
    // Re-check game.user after the implicit await chain — a transient
    // disconnect race could null it out between the check above and the
    // setFlag call.
    if (!game.user) return;
    await game.user.setFlag("dice-so-nice", "settings", merged);
  } catch (e) {
    warn("applyPreset: failed to write DSN flag", e);
    return;
  }
  log(`perf preset → ${name}`, profile);
  const presetLabel = game.i18n.localize(`${MOD_ID}.tray.perf.${name}`);
  ui.notifications?.info?.(
    game.i18n.format(`${MOD_ID}.tray.perfPresetChanged`, { preset: presetLabel })
  );
}

export const PRESET_LIST = [...PRESET_NAMES];
