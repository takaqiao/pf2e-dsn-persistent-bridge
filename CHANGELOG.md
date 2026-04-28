# Changelog

## Unreleased

### Features

- **Blind-roll ghost ceremony.** When a player opens a `blindroll` dialog, instead of skipping spawn entirely the module now generates a **ghost task die locally**: every face of that physical die renders as "?" so the player can drag and throw it for the ritual feel without ever seeing the value. The ghost die is intentionally NOT tagged as module-owned, so its result is ignored — PF2e's check still uses pure system RNG, and the actual outcome stays visible only to the GM. Result leak is impossible because the player physically cannot read the face.
- **Secret rolls are now honored.** When a PF2e dialog uses `gmroll` / `blindroll` / `selfroll`, the module behaves correctly:
  - Task dice are spawned only on the client that should see the result (GM for `gmroll`/`blindroll`, opener for `selfroll`).
  - Never broadcast across socket, so other players don't see the dice physically land on their canvas (no result leak).
  - Players who shouldn't see the result get a clean banner in the slot tray explaining the dialog is in secret mode and is falling back to system RNG.
  - Toggleable via new world setting `respectSecretRolls` (default on).

### UX polish

- Slot fill animation: when a thrown die lands and fills a slot, the slot now flashes green briefly and the number scales in (~400ms). Pure CSS, zero perf cost.

### Repo / packaging

- Added GitHub Actions release workflow (`.github/workflows/release.yml`):
  pushing a `v*` tag now auto-builds `module.zip` and publishes the GitHub
  release with `module.json` + `module.zip` as assets.
- Added `scripts-dev/release.sh` helper for one-command version bumps
  (`./scripts-dev/release.sh patch` etc.).
- Added issue templates (bug report, feature request) and a PR template.
- Added `license: "MIT"` to `module.json` (SPDX identifier).
- Added Foundry package submission walkthrough at
  `.github/FOUNDRY_PACKAGES_SUBMISSION.md`.

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
