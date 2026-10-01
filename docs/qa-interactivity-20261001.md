# Persistent Dice 0.5.4 interactivity fix — 2026-10-01

## Cause and change

The active `sog` world had DsN's `allowInteractivity` setting disabled. The module was enabled, but 0.5.3 rejected that setting in `adapter.ready()` before mounting the tray. This also reproduced in the isolated QA world: DsN's box was ready with `allowInteractivity=false`, while the bridge was disabled and no tray element existed.

The fix removes that configuration check and keeps the native interface checks. It does not change the world setting or install DsN's global input listeners. Native 6.4.1 source confirms that board initialization still creates its worker, input handler, persistent manager and throw engine with interactivity disabled. Task spawning starts the native ticker, and task bodies keep its rendering and physics steps active until cleanup.

## Native verification

The isolated world used Foundry 14.368, PF2e 8.5.1, DsN 6.4.2 and libWrapper 1.13.5.1. The setting and box flag both remained false during the tests.

- The patched tray appeared for both GM and player accounts.
- The player's first prepared `3d6 bludgeoning + 1d4 fire` grab took 10.6 ms from lift movement to held state. No long task was recorded in the first 350 ms. All four held parent quaternions remained identity while their positions followed the pointer; native rendering continued and scale reached 1.
- A 4 px rightward release produced one physical chat result, total 9 with d6 results `[1,3,2]` and d4 `[3]`. The Roll and both Die terms carried `{x:1,y:0}`. Cleanup left zero held dice, task bodies, sessions and dialogs, with no persistent-dice broadcast.
- A stationary release produced one physical check, total 15, with one random direction. Esc canceled a held two-die batch without adding a message or leaving task bodies.
- The native Roll button produced a normal check, total 6, without physical completion or direction metadata, and played one native DsN animation.

The QA setting was restored after testing. Production world settings were only read during diagnosis. DsN 6.4.1 was checked against its native source for this fix; the false-setting browser regression used 6.4.2. Earlier 0.5.3 integration testing covered both versions, as recorded in [performance QA](qa-performance-20261001.md).

## Code checks

The new regression fails against the old startup guard and passes after its removal. It covers local task grabbing, directional release, settlement, broadcast isolation and restoration of the disabled native capability. All 178 tests and syntax, manifest, language and entry-point checks pass. Independent review found no blocking issue.
