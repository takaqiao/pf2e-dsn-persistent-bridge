# Changelog

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
