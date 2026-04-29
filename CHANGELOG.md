# Changelog

## 0.2.3 — 2026-04-30

### Performance

- **Hidden-viewer auto-cleanup.** When your DSN persistent-dice visibility is "Show only mine" or "Hide all", another player opening a dialog used to drop their broadcast task dice on your `persistentDiceList` and keep them there until the opener closed the dialog — invisible but still ticking through DSN's physics worker each frame. Now: a 4 Hz poll runs only while at least one foreign task die is on the canvas, removes each one locally as soon as it settles (`forcedResult` populated, `persistentThrow` cleared) plus a 200 ms grace. Post-throw idle drops from "until opener closes the dialog" to ~200 ms; the throw animation itself is unaffected. Pre-throw idle (between the opener's dialog opening and them actually throwing) is unchanged for now.

## 0.2.2 — 2026-04-29

### Fixes

- **Task dice no longer accumulate on others' canvases.** When DSN's per-user persistent-dice visibility is set to "Hide all", task dice are now spawned **local-only** (sync=false). Other clients receive nothing — no mesh, no physics tick, no orphan to clean up later. With visibility "Show only mine" / "Show all", the existing behavior is preserved (others see your throw animation as a social cue).
- **"Hide all" no longer breaks the throw flow.** A local visibility patch on `persistentDiceManager._applyPersistentDieVisibility` keeps task dice we tagged `dsnPF2eBridge_forceVisible` visible to the opener even when the global filter is set to hide everything — so you can still see and throw them. After the dialog closes, cleanup removes them and the canvas is empty again.
- **Defensive orphan sweep.** On every dialog open and once at module ready, scan `persistentDiceList` for any mesh tagged as one of our task dice whose dialog is no longer registered, and remove it. Catches edge cases where a dialog closed without firing the close hook (mid-render error, unusual tear-down path) and left dice stranded on the canvas. The previous remedy was "manually clear via the toolbox".

### Features

- **Performance preset button in the tray.** A new chip in the tray header (next to Select-all / Mine-only) shows the current DSN image-quality bundle (Low / Medium / High / Custom) and, on click, cycles Low → Medium → High. Writes a coherent set of fields to `dice-so-nice.settings` (imageQuality + shadowQuality + bumpMapping + useHighDPI + antialiasing + glow + persistentDiceOutlines + advancedGlass) matching DSN's own `core.performanceMode` mapping. Most fields are `requiresReload`, so the toast notification asks for F5 to apply. The button reflects whatever's currently in the DSN settings panel — toggling either side stays in sync.

## 0.2.1 — 2026-04-29

### Diagnostics

- **Disabled banner now tells you *why*.** Instead of a generic "Dice So Nice persistent dice are not active", the banner names the specific failure:
  - `libWrapperMissing` — lib-wrapper not installed/enabled (without it, slots fill but predetermined values never reach the actual roll → looks like "the dice rolled twice with different values")
  - `moduleMissing` — DSN module not installed/enabled
  - `persistentOff` — DSN's "Display persistent dice" world setting is off
  - `interactivityOff` — DSN's "Allow players to interact with dice on the canvas" world setting is off
  - `managerMissing` — settings look right but `game.dice3d.box.persistentDiceManager` hasn't initialized; DSN settings are `requiresReload`, so refresh (F5)
- **Console diagnostic helper.** `game.modules.get("pf2e-dsn-persistent-bridge").api.diagnose()` dumps DSN active flag + version, both world settings, dice3d/box/manager presence, libWrapper state, system id. Run it in a tester's console to file a bug report.
- **Suppression-hook telemetry.** `dsn-suppressor` now logs whether each `diceSoNiceMessagePreProcess` firing actually suppressed or let DSN proceed, including the `rollOptions` keys when not suppressed — so you can tell "wrapper didn't run" from "flag didn't survive serialization" at a glance.

### Settings

- New: `verboseLogging` (client, default off). Per-step traces (matched die, settle timing, evaluate-wrapper injection, suppression-hook decisions) only print when this is on. Console stays quiet during normal play; flip on when filing a bug. Warnings and errors are unconditional.

## 0.2.0 — 2026-04-29

### Features

- **Full secret-roll support across every mode.** `gmroll` / `blindroll` / `selfroll` from PF2e are now first-class citizens:
  - **GM Roll / Blind Roll / Self Roll** opener: throws their own task die locally; the dialog auto-submits with the real value.
  - **Player-opened Blind Roll**: opener gets a *ghost* die (every face shows "?") so they can throw for the ritual without learning the result. The value still flows internally and feeds PF2e via `_roll` injection — the slot tray shows "?" instead of the number, the chat is hidden by PF2e's blindroll routing, and the dice the player physically threw match the chat result the GM reads.
  - **Cross-client mirror sync**: the throw is replayed on every other client at the right fidelity:
    - GM viewers see a *real* die animation with the actual value.
    - Other player viewers see a *ghost* die animation (face = "?") so they get the social cue of "someone is rolling" without the value leaking.
  - Live DOM tracking of the dialog's `<select name="messageMode">`: changing roll visibility mid-dialog re-evaluates the spawn (cleans up old dice, spawns new ones in the appropriate mode), so the GM can flip "Public → Blind" right before submitting and the module reacts immediately.
  - World setting `respectSecretRolls` (default on) toggles the whole feature off if you want every roll treated as public.

- **Select-all button + auto-select-on-spawn setting.** Multi-die rolls (damage `1d8 + 2d6 + 1d4`) now have a one-click "Select all" button in the tray header, and a per-client `autoSelectAllOnSpawn` setting that selects them automatically the moment they land — so a single drag throws every die instead of needing Ctrl+click on each.

- **Slot fill animation.** When a thrown die lands and fills a slot, it flashes green briefly and the number scales in (~400ms). Pure CSS, zero perf cost.

### Fixes

- **Refresh-orphan dice are gone.** Previously a browser refresh while a dialog was open left an undeletable persistent die on the canvas (DSN had auto-saved it to user flags during spawn). Spawns now run under DSN's own `_restoringDice` gate, which short-circuits the persistent-flag write — no setFlag in flight, no race window, no orphan after refresh.
- **Roll-mode string compatibility.** Foundry v13/v14 changed `CONFIG.ChatMessage.modes` value strings (`"blindroll"` → `"blind"` etc.). The classifier now normalizes both spellings — earlier versions silently treated every secret roll as public on v13+.
- **Tray buttons no longer stretched** by PF2e's `width: 100%` form-button default — the "Mine only" / "Select all" buttons stay content-sized.
- **GM-opener gm/blind also mirrors ghost** to other players (was missing — observers saw an empty canvas).
- **Ceremonial throws auto-submit.** Player-blind ghost dice now correctly trigger the dialog submission once all have landed (was stalling).
- **DSN throw message hidden in dialog mode** — the redundant standalone "you rolled X" message that DSN posts on every persistent throw is now suppressed while a roll dialog is open, so chat shows only the PF2e check result (one message instead of two).

### Settings

- New: `autoSelectAllOnSpawn` (client, default off).
- New: `respectSecretRolls` (world, default on).
- Default change: `settleBufferMs` 3500 → **100ms** (range now 0–1000ms).
- Default change: `autoSubmitDelayMs` 1000 → **100ms** (range now 0–1000ms).
- Removed `consumeAnyOwner` (subsumed by `onlyConsumeOwned` default-on).
- Removed `matchPriority` (single-client routing makes priority meaningless).
- Removed `showLockButton` (per-slot manual lock obsoleted by the access-toggle).

### i18n

- **Simplified Chinese works again.** `module.json` now declares both `cn` (Foundry's historical Simplified Chinese code) and `zh-CN` (BCP-47), pointing at the same translation file. *Note: a Foundry **server restart** is required after upgrading from 0.1.x to pick up the new lang declaration — Foundry caches `module.json` in process memory at startup.*

## 0.1.0 — 2026-04-28

Initial release.

- Auto-spawn task dice matching the roll formula (check / damage / reroll).
- Decorative-vs-task dice separation — your manually-spawned dice never get pulled into a roll.
- Decorative dice visually hidden while a dialog is open.
- Task dice locked to dialog opener (other players can't drag), with one-click unlock toggle.
- Cross-client socket sync of the `lockedBy` field.
- Per-Die `_roll` patching to inject canvas results into `CheckRoll` / `DamageRoll` evaluation, preserving PF2e modifiers (`kh`/`kl`/`r1`/`xo`/`min`/`max`).
- Auto-submit on full slot fill with a tunable settle buffer.
- Suppresses the redundant DSN throw chat message during a dialog (only the PF2e result message remains).
- Partial fill: empty slots fall back to RNG.
- libWrapper integration for safe `evaluate` wrapping.
