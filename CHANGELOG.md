# Changelog

## 0.2.5 — 2026-04-30

### Features

- **Right-click any of your persistent dice → random-direction throw.** No more vigorous shaking. New client setting `rightClickAutoThrow` (default on). We monkey-patch DSN's `inputHandler.onMouseDown` so `event.button === 2` bypasses the pickup flow and calls `pdm.throwPersistentDice` directly with a randomized velocity (speed × 0.7–2.6, loft × 0.7–1.4 for "every toss feels different"). If the hovered die is part of an active multi-selection (Ctrl+click or the tray's Select-all button), every selected die throws in one batch. d100/d1000 link-group siblings are auto-included.
- **Ephemeral mirror for hidden viewers + ghost-dice for hidden breakdowns.** Two related issues this fixes:
  - Players whose DSN visibility is "Show only mine" / "Hide all" used to see *nothing* when others rolled — DSN's `parent.visible=false` covers idle, throw replay, and rest of every foreign persistent die.
  - PF2e's "Show Roll Breakdowns" off (the typical NPC-roll case) used to leak the actual die value to all-mode receivers because DSN's persistent-throw broadcast renders the real face.
  - Both addressed by a unified socket-mirror flow. Opener-side: hook `dice3d._emitPersistentEvent("throw")` to mirror task throws the moment they happen, plus `createChatMessage` for direct Roll-button clicks (no persistent throw). Receivers in mine/none mode play `game.dice3d.showForRoll(roll, game.user, false)` — DSN's standard ephemeral 3D animation, predetermined value, auto-clears. When `roll.options.showBreakdown === false` and the receiver isn't the GM, ghost flag is set at all four DSN propagation points (`roll.ghost`, `roll.options.appearance.isGhost`, `term.options.appearance.isGhost`, `showForRoll`'s `options.ghost` arg) so the "?" face survives any DSN appearance pipeline override.
  - For task throws on `showBreakdown=false` rolls: opener now spawns local-only (`sync=false`) so DSN's broadcast can't leak the real value to all-mode receivers; the mirror flow shows everyone (incl. all-mode) a ghost ephemeral. Works because `showBreakdown` is recovered from the dialog's `context.actor.hasPlayerOwner` (CheckModifiersDialog) or `context.self.actor.hasPlayerOwner` (DamageModifierDialog) at render time — the roll itself doesn't exist yet on the dialog.
  - Dedup: chat-message path skips when `roll.options._dsnPersistentSourced === true` (set by evaluate-wrapper) or when the message is DSN's own `persistent`-flagged throw chat — so we never double-emit for the same physical throw.
  - New world setting `mirrorThrowToHiddenViewers` (default on).
- **First-time welcome message.** Self-whispered chat message describing how to use the module (drag-shake or right-click; Ctrl+multi-select then right-click; empty slots fall back to RNG). Sent once per major-feature version, version-keyed flag so future feature updates can re-send. Tray hint also updated to match.

### Fixes

- **Visibility path bug** (severe — affected 0.2.2 / 0.2.3 / 0.2.4). Three call sites read `game.dice3d.persistentDiceVisibility`, but that getter is on `DiceBox`, not `Dice3D` — they all silently received `undefined` and fell back to `"all"`. Net effect: the spawn-policy branch for "Hide all", the foreign-mirror skip-on-receive in "mine"/"none", and the ephemeral-mirror visibility check were all *no-ops* for the user's actual setting. Fixed by reading `game.dice3d.box.persistentDiceVisibility` everywhere. Hidden-viewer optimizations and visibility-aware spawn now actually run for the first time.
- **Mirror timing regression**. Earlier 0.2.5 prerelease moved mirror trigger to `createChatMessage`, which fires only after settle + auto-submit + chat creation (~2 s lag). Restored fast path: `pdm.onPersistentEvent("throw")` fires the moment the throw starts. The chat-message path is kept for direct Roll-button clicks (no persistent throw) and gated by `_dsnPersistentSourced` to prevent double-emit.
- **Mirror hook race with DSN init**. Wrapped `dice3d._emitPersistentEvent` directly (a stable instance method) instead of `pdm.onPersistentEvent` (which DSN's `box.initialize()` rewires asynchronously, overwriting our wrapper). No more "throw hook installed but never fires" silent failure.

### Polish

- **Perf preset button now reads `Dice3D.CONFIG()` (effective settings)**, not just the user flag. New users with empty DSN flag still see the correct preset label (matching their `core.performanceMode`-derived defaults) instead of "Custom".
- **High preset matches DSN's WebGL2 antialiasing exactly**: dynamically picks `"msaa"` on WebGL2 contexts (the typical case), `"smaa"` on WebGL1 fallback. Was hard-coded to `"smaa"` before, which meant WebGL2 users with `core.performanceMode=High` and an untouched DSN flag would see the tray button label "Custom" (one field off) instead of "High".
- Tray hint and welcome message rewritten to be one-line / three-line direct usage instructions instead of a manual.

## 0.2.4 — 2026-04-30

### Performance

- **Hidden-viewer skip-on-receive (replaces 0.2.3's settle-cleanup).** Empirical check: DSN's `_applyPersistentDieVisibility` sets a foreign die's `parent.visible=false` at spawn and never re-enables it — not even during throw replay. So in "Show only mine" / "Hide all" the receiver never actually sees foreign throws either; the mesh is invisible from spawn to removal. 0.2.3's "wait until settle then remove" was therefore wasted work — the mesh ticked through an entire invisible throw. 0.2.4 removes locally **on receive** instead: hook `dice-so-nice.persistentDiceChanged`, find any foreign-owned task die we tagged, schedule a microtask-deferred `removePersistentDie(id, false)`. Net canvas cost on hidden-viewer clients: zero. Visually identical (both versions show nothing). Opener-side broadcast cleanup still fires at dialog close; DSN no-ops on already-removed dice.

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
