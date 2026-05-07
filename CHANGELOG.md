# Changelog

A short, plain-language summary of what changed in each release. For full
technical detail (race conditions, code references, internal reasoning),
see [`CHANGELOG-DEV.md`](./CHANGELOG-DEV.md).

## 0.4.5 — GM-only decorative persistent dice

- New world setting **"Block players from creating decorative persistent
  dice"** (default on). Players can no longer spawn their own persistent
  dice via DSN's toolbox or console — only the bridge module's task
  dice are allowed to appear. The GM is unrestricted and can still
  spawn freely.
- When a player tries to spawn a die under this setting, they get a
  toast notification and the die isn't created. A console line
  (`[PF2e×DSN restrict-spawn] blocked spawn (...)`) records the attempt
  for the GM to inspect.
- This only stops NEW spawns. Existing decorative dice from before the
  setting was turned on are still on the canvas — clear them via DSN's
  own toolbox "Clear all" once.

## 0.4.4 — Quiet console by default

- All module diagnostics (shake detection, right-click throws, cross-
  client mirror sync, flavor sync, visibility decisions) now respect the
  "Verbose console logging" setting. Previously several of these printed
  unconditionally — handy when actively debugging, noisy at the table.
  Off by default; flip the setting on if you're filing a bug report or
  want to see exactly why a roll behaved the way it did.
- The `api.diagnose*()` console helpers still print regardless — those
  are explicitly invoked from the F12 console and should always speak.

## 0.4.3 — Threshold 1 = "release-throws"

- Fixed: at threshold=1 some flick attempts still didn't trigger because
  DSN samples mouse motion every 40ms — a fast flick can happen entirely
  between two samples, leaving the recorded path so small the catchall
  ignored it. At threshold=1 the bar is now simply "any drag-with-
  release throws", no minimum motion. DSN's own throw-velocity calc
  takes the samples it has, or falls back to a random-direction min
  velocity throw — anything's better than silently dropping the die.
- Higher thresholds scale the bar linearly (2 = light motion, 3 = some
  motion, 4 = deliberate motion). Threshold=5 still matches DSN exactly.

## 0.4.2 — Shake sensitivity feels natural now

- Fixed: at low thresholds the throw still didn't always trigger, because
  the natural human gesture is "wind up briefly, then release" — people
  don't hold the mouse down until the trigger heuristic catches up.
  Added a release-time check: if you held a die and moved it at all
  during the hold, releasing the mouse now throws the die. DSN's own
  velocity calculation handles direction from your drag path.
- Slightly more aggressive mid-drag velocity bypass too, so a faster
  flick triggers even sooner.

## 0.4.1 — Shake sensitivity, made actually sensitive

Three follow-ups on 0.4.0:

- Fixed: dragging the slider in the popup didn't update the number on the
  right (Foundry's CSP was dropping the inline handler). Live updates now.
- Saving takes effect immediately. No reload required, ever.
- Lowering the threshold now actually catches a clean throwing flick. The
  earlier version only relaxed DSN's "shake" detector — but a clean throw
  is unidirectional and DSN's detector specifically requires direction
  reversals, so a flick never triggered no matter how low you set the
  slider. We now also detect a fast unidirectional drag (read straight
  from the held-die mouse path) when the slider is below 5. At 1–2 a
  short flick triggers the throw; at 3–4 you need a deliberate flick.
- Added unconditional `[PF2e×DSN shake]` console diagnostics — every
  trigger or suppression logs why, useful for tuning the slider.

## 0.4.0 — Adjustable shake sensitivity

- Added: shake-to-throw is now adjustable. DSN ships with a fixed shake
  threshold (you have to wiggle a die hard before it flies); some users
  found that too stiff. There's now a slider 1–10, where lower = easier
  to trigger.
- **Where to find it:** the slot tray (the panel under a roll dialog) has
  a new **Shake** button next to the perf preset. Click it → slider
  popup → save. Takes effect immediately, no reload needed.
- Default is **5** (DSN's built-in value, unchanged behavior). Try **2–3**
  if shaking feels unresponsive.
- The setting also lives in Settings → Module Settings if you prefer the
  standard panel.

## 0.3.1 — Right-click reliability

- Fixed: right-click to throw would silently stop working after a window
  resize or a DSN performance preset change. Right-clicking would just
  pick up the die (DSN's default) instead of throwing it.
- Added unconditional console diagnostic logs for right-click attempts
  (tagged `[PF2e×DSN right-click]`) — when a click misses, the log says
  why (no die under cursor / locked to someone else / mid-throw / etc.).

## 0.3.0 — Polish & docs

- All settings descriptions rewritten in plain language. No more code
  jargon — each setting tells you what it does and when you'd toggle it.
- Changelog split: this file is now the user-facing summary; the verbose
  technical history is in `CHANGELOG-DEV.md`.
- Removed three leftover settings that were exposed in the UI but no
  longer wired up to anything.

## 0.2.9 — Visibility now follows PF2e Alliance

- The "should other players see this actor's dice?" decision now uses
  PF2e's built-in **Alliance** field instead of guessing from actor type.
- **How to set it:** open an actor sheet → Configure (gear icon, top
  right) → set Alliance to **Party** to broadcast, or **Opposition /
  Neutral** to hide.
- Cohorts, ally NPCs, hirelings: explicitly set Alliance: Party so other
  players see their dice.
- Enemies, neutral NPCs: leave Alliance as Opposition / null. Other
  players will only see a brief ghost ("?") throw animation, not the
  actual dice values.
- Console log `[PF2e×DSN visibility]` shows the decision per spawn if
  you're troubleshooting.

## 0.2.8 — Receiver-side colors + GM-only PCs

- Multi-player sync: when a player rolls fire damage, every other player
  now sees fire-themed dice (using each viewer's own DSN damage-type
  configuration), not the roller's defaults.
- GM-controlled pre-gen / unassigned PCs now broadcast their dice
  correctly. Previously they were treated as NPCs and other players saw
  ghost dice.
- Damage dialog: the source actor (your PC) is correctly identified
  even when there's a target NPC selected — fixes stray ghost dice on
  damage rolls.

## 0.2.7 — Per-damage-type dice colors

- Damage roll task dice now match their damage type — fire is red-orange,
  cold is blue, vitality is gold, void is dark purple, etc.
- Auto-registers 11 PF2e damage types (electricity, sonic, vitality,
  void, spirit, mental, bleed, slashing, piercing, bludgeoning, untyped)
  as configurable colorsets in DSN. Customize them in
  *Module Settings → Dice So Nice → Damage Type Configuration*.
- Skipped automatically if you already have *PF2e Dice Flavor Fix*
  installed (it does the same job in more depth).
- Fixed: PF2e v8 damage formula structure — task dice now spawn with the
  correct count (was missing dice on some rolls).
- Fixed: PF2e's "Critical hit doubles dice" setting — your task dice now
  match the doubled count on a crit.
- Fixed: rule-element formula dice (e.g. kineticist scaling) now spawn
  correctly.
- New diagnostic helpers:
  `game.modules.get("pf2e-dsn-persistent-bridge").api.diagnoseFlavor("d6", "fire")`
  shows what colorset a die would get; `diagnoseTaskDice()` lists what's
  on canvas; `diagnoseDialog()` dumps PF2e dialog structure.

## 0.2.6 — Dialog cleanup race fix

- Fixed a subtle bug where task dice could occasionally linger on the
  canvas after closing a check / damage dialog, especially if you closed
  it quickly. They now reliably clean up.
- PF2e v8 compatibility verified.

## 0.2.5 — Hidden viewers, right-click throw

- Right-click any of your dice to throw it in a random direction at
  reasonable speed — no more vigorous shaking. Multi-select with
  Ctrl+click first to throw a batch in one go.
- Players whose DSN visibility is "Show only mine" / "Hide all" now see
  a brief throw animation when others roll, instead of nothing at all.
- Hidden-breakdown rolls (NPC attacks etc.) show ghost dice ("?") on
  other players' canvases — the value is hidden but the action is visible.
- First-time welcome message describes how to use the module in 3 steps.

## 0.2.0 – 0.2.4 — Foundation

- Slot tray panel injected into PF2e check / damage dialogs.
- Drag-shake or right-click your persistent dice — values fill the slot
  tray and feed PF2e's roll evaluation.
- Multi-die damage (1d8 + 2d6 + 1d4 etc.) supported.
- Reroll (hero point / fortune) supported.
- d100 (linked d10 + d10) supported.
- Auto-spawn task dice on dialog open, auto-cleanup on close.
- Auto-submit when all slots filled.
