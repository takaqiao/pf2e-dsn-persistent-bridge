# Changelog

A short, plain-language summary of what changed in each release. For full
technical detail (race conditions, code references, internal reasoning),
see [`CHANGELOG-DEV.md`](./CHANGELOG-DEV.md).

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
