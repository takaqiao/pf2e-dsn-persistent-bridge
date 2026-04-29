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

const PRESET_PROFILES = {
  low: {
    imageQuality: "low",
    shadowQuality: "low",
    bumpMapping: false,
    useHighDPI: false,
    antialiasing: "none",
    glow: false,
    persistentDiceOutlines: false,
    advancedGlass: false,
  },
  medium: {
    imageQuality: "medium",
    shadowQuality: "low",
    bumpMapping: true,
    useHighDPI: false,
    antialiasing: "none",
    glow: false,
    persistentDiceOutlines: false,
    advancedGlass: false,
  },
  high: {
    imageQuality: "high",
    shadowQuality: "high",
    bumpMapping: true,
    useHighDPI: true,
    antialiasing: "smaa",
    glow: true,
    persistentDiceOutlines: true,
    advancedGlass: true,
  },
};

function readDsnSettingsFlag() {
  try {
    return game.user?.getFlag("dice-so-nice", "settings") ?? null;
  } catch {
    return null;
  }
}

export function getCurrentPreset() {
  const flag = readDsnSettingsFlag();
  if (!flag) return null;
  for (const name of PRESET_NAMES) {
    const p = PRESET_PROFILES[name];
    if (
      flag.imageQuality === p.imageQuality &&
      flag.shadowQuality === p.shadowQuality &&
      !!flag.bumpMapping === p.bumpMapping &&
      !!flag.useHighDPI === p.useHighDPI
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
  const profile = PRESET_PROFILES[name];
  if (!profile) {
    warn(`applyPreset: unknown preset ${name}`);
    return;
  }
  if (!game.user) return;
  const cur = readDsnSettingsFlag() ?? {};
  const merged = { ...cur, ...profile };
  try {
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
