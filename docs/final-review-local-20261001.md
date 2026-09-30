# Local tray review — 2026-10-01

Fresh independent reviewer: gpt-6-astra, xhigh, read-only. Scope: the user-approved 0.5.1 local-tray amendment. One review and one implementer fix pass; no second review was dispatched. Critical: none found. The bounded browser acceptance subsequently completed; evidence and unverified cases are in [qa-local-20261001.md](qa-local-20261001.md).

## Findings and disposition

Important I1: task event isolation depended on the ownership map, so a late native event could escape after mesh cleanup or after teardown restored the native emitter. Fixed: each task mesh has a stable `pd-die:<userId>:<UUID>` ID supplied through native `remotePersistentId`. The emitter checks `persistentId`, `persistentIds` and `positions[].persistentId`, and skips empty move payloads. Invalid task throws stop before native RNG. Release and move Promises drain before disposal removes event isolation. Three asynchronous-event regressions and an additional native move-payload regression failed before the fix and passed afterward.

Important I2: a message containing a complete physical Roll and an enabled visible inline RNG result could lose its native animation. Fixed: that combination keeps the entire native animation. The regression covering enabled, disabled and hidden inline results failed before the fix and passed afterward.

Completeness uses a Set of the actual injected die-result objects, including the final evaluated results rather than descriptor counts alone. Only complete local revisions are remembered. Suppression requires every dice-bearing Roll in the author's message to qualify. Partial Rolls, mixed messages and enabled visible inline RNG results retain full native animation; the author's physical dice may therefore animate again.

The native fixed-dice gate is opened per box only for local guests whose prefix, reserved user and owner match. Startup clears already restored meshes locally, late restoration is caught through `persistentDiceChanged`, and saved flags are retained without socket removals. Disposal restores the current native world setting. These boundaries are covered by regressions; migration and teardown still need actual browser evidence.

Minor (deferred): README/CHANGELOG promise no duplicate animation without qualifying partial/mixed cases. Their original sentences remain unchanged under the executing-plans Minor disposition; the actual replay tradeoff is recorded above and in amendment A6.

Minor (deferred, existing): initial light-theme material colors are not applied until a later body-class mutation.

## Declined to judge and implementer rulings

1. D1: the existing initial light-theme Minor remains deferred. An initially light client sees the dark palette until a later theme-class change; this remains a Minor, not a new ruling.
2. Ruling D2: identical client trajectories/collisions and an octagonal collision simulator are outside the approved scope. Receiver animations use the native chat path. Cost if wrong: clients see different directions and collisions; reported dice results must still agree.
3. Ruling D3: elemental blast, inline damage and windowless paths remain native-only. Cost if wrong: these entries have no manual tray interaction, while native PF2e rolling remains available.
4. Ruling D4: browser acceptance depends on the implementer's actual runtime evidence; this review makes no long-duration GPU/memory claim. Cost if wrong: remaining live cases and extended-session resource behavior need manual checks and may expose further fixes.
5. Ruling D5: compatibility remains bounded to Foundry 14.368, PF2e 8.5.1 and DsN 6.4.1. Cost if wrong: other versions can need adapter changes and new runtime verification. This reaffirms the existing compatibility boundary.
6. Ruling D6: release, push and production installation remain unauthorized; retain the local candidate. Cost if wrong: publication and deployment await authorization and the remaining verification. This reaffirms the existing release boundary.

The implementer reported `npm test` 109/109, `npm run check` and `git diff --check` passing after the one fix pass. These checks establish code-level evidence only. No 0.5.1 browser-pass claim is made here, and the 0.5.0 QA record remains historical evidence.
