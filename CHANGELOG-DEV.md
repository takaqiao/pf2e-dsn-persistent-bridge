# Developer Changelog

Verbose technical history — implementation details, code references, race
conditions, and design reasoning kept for debugging and reference. The
user-facing summary lives in `CHANGELOG.md`.

## 0.3.1 — 2026-05-03

### Fixes

- **Right-click throw silently broke after `box._buildDiceBox()` rebuilds.** DSN re-creates the `DiceBox` (and a fresh `inputHandler` instance with it) on window resize via `resizeAndRebuild`, on DSN performance / quality changes, and on settings reloads. v0.2.5's right-click implementation patched `inputHandler.onMouseDown` on the LIVE instance — every rebuild stripped the patch, leaving DSN's stock pickup-on-mousedown behavior in place, so right-click started picking dice up instead of throwing them. Fix: patch `Object.getPrototypeOf(inputHandler).onMouseDown` (i.e., `InputHandler.prototype.onMouseDown`) instead. Class methods live on the prototype, so all current and future InputHandler instances inherit our wrapper automatically. Idempotency guarded via a `proto._dsnBridgeRightClickPatched` sentinel.

### Diagnostics

- Added unconditional `[PF2e×DSN right-click]`-tagged console logs at every step of the right-click flow:
  - On install: `installed (prototype-patched, survives box rebuilds)` confirming the patch landed.
  - On miss: explicit reason (`no die under cursor`, `not a persistent die`, `owned by X (you're Y)`, `locked to X`, `currently replaying a remote throw`, `currently mid-throw (settle in progress)`).
  - On hit: `thrown N die(s)`.

## 0.3.0 — 2026-05-03

(Polish-only release — see CHANGELOG.md for the user-facing summary. No
behavior changes; settings descriptions rewritten in plain language,
CHANGELOG split into user / dev versions, three orphan lang keys removed.)

## 0.2.9 — 2026-05-03

### Fixes

- **Visibility decision rewritten around `actor.alliance`.** v0.2.8's three-layer cascade (`type === "character" || parties.size > 0 || hasPlayerOwner`) was too liberal — adding an NPC to a party for ANY reason (combat tracking, encounter prep, hireling roster) leaked the NPC's dice into broadcasts even when it was clearly an enemy. The alliance system is PF2e's explicit ally-vs-enemy classifier and is the cleanest signal for our purpose. Both `pf2e-toolbelt` and `xdy-pf2e-workbench` use `alliance === "party"` for their respective ally checks, so we're aligned with community precedent and PF2e's own internal pattern (`ALLIANCES.has(stored) ? stored : (hasPlayerOwner ? "party" : "opposition")`). New decision tree, priority-ordered:
  1. **Stored alliance is `"party"`** → broadcast (visible).
  2. **Stored alliance is `"opposition"` or `null`** (explicit neutral) → local-only (ghost mirror).
  3. **Stored alliance is `undefined`** (sparse old saves):
     - `actor.type === "character"` → broadcast (covers GM-only PCs / pre-gens whose template hasn't initialized alliance).
     - else → fall back to `hasPlayerOwner`.
- **Receiver-side flavor sync now goes through remove + local re-spawn instead of in-place material swap.** v0.2.8's hot-swap (`mesh.material = tempMesh.material`) was theoretically correct but in practice DSN's renderer keeps internal program / shader caches keyed off the ORIGINAL material's UUID. Live-swapping the material reference didn't always pick up the new texture atlas / colorset, so receivers continued to render with the opener's default appearance. We now `dice3d.removePersistentDie(id, false)` (local-only, no broadcast) and re-spawn locally with `remotePersistentId=id` and the flavored appearance. The receiver sees a single-frame flicker (~16 ms) which is imperceptible vs the throw animation that typically follows immediately. Persistent ID is preserved so DSN's throw replay continues to find the mesh by id.

### Diagnostics

- Added unconditional `[PF2e×DSN flavor-sync]`-tagged console logs at every step of the flavor-sync flow (emit / receive / queue / flush / re-spawn).
- Added unconditional `[PF2e×DSN visibility]` log at each task-die spawn showing `actor / type / alliance / hasPlayerOwner / showBreakdown / broadcast` — so you can grep "why did THIS NPC's dice broadcast (or not)?" in the browser console without enabling verboseLogging.

### Customizing per-actor visibility

Set the actor's alliance via PF2e's Actor Sheet → Configure (gear icon) → "Alliance" dropdown:
- **Party** — dice broadcast as a public PC roll (other players see the actor's task dice on their canvas, flavored per damage type).
- **Opposition / Neutral / Default** — dice spawn local-only on your client + ghost-throw replay for non-GM viewers (preserves value protection for enemy / neutral rolls).

### Visibility decision now goes through three independent checks (in order)

1. `actor.type === "character"` — PC type. Catches GM-controlled PCs / pre-gens / characters whose player isn't currently online.
2. `actor.parties?.size > 0` — party membership. Catches NPC allies, cohorts, hirelings explicitly added to the party.
3. `actor.hasPlayerOwner` — PF2e's stock check. Catches familiars, animal companions, eidolons (ownership cascades from their PC master), and anything else the GM has granted a player OWNER on.

Anything else (NPC enemies, hazards, vehicles without party membership) keeps the value-leak protection: spawned local-only, ghost-throw replay for non-GM viewers.

## 0.2.8 — 2026-05-03

### Fixes

- **Receivers in multi-player sessions saw default-colored task dice instead of the per-damage-type colorset.** When the opener spawned a task die for a public PC roll, DSN's own broadcast handles distributing the spawn — but DSN's broadcast carries only the opener's RAW user appearance (`Dice3D.APPEARANCE(user)`), no flavor info. Receivers' `_onRemotePersistentCreate` then computes appearance via `getAppearanceForDice(raw, dieType)` with no term arg, producing the opener's default. Net: a fire damage task die looked fire-themed on the opener and default on every other client. We now emit a follow-up `task-flavor-sync` socket message after each successful flavored spawn. Receivers listen, build the appearance using THEIR own DSN settings + opener's flavor, and swap the existing mesh's material in place via `factory.create` (with a "showcase"-typed textureCache to dodge the physics-shape side effect, and the resulting mesh's material is hot-swapped into the existing mesh — no flicker, no remove/respawn). Race protection: if our flavor message arrives before DSN's spawn lands on the receiver, we cache the flavor by `persistentId` (30 s TTL) and apply on the next `dice-so-nice.persistentDiceChanged` hook fire.
- **GM-controlled PCs without a player owner triggered the NPC-protection path, making other players see ghost dice instead of real ones for the GM's PC damage rolls.** PF2e's stock `showBreakdown` heuristic uses `actor.hasPlayerOwner`, which returns false when only the GM has OWNER permission on a character (typical for pre-gens, NPC allies, or PCs whose player is offline / unassigned). Our `inferShowBreakdownFromDialog` followed PF2e's heuristic verbatim, marking these rolls as breakdown-hidden → spawning local-only → forcing other players' ephemeral mirror to render as ghost. Now we additionally treat `actor.type === "character"` as breakdown-visible regardless of `hasPlayerOwner`. The actor TYPE is the more reliable PC/NPC signal; `hasPlayerOwner` is a permissions check that doesn't always match intent. Non-character actor types (npc / hazard / vehicle) still respect `hasPlayerOwner` to keep the value-leak protection for genuinely GM-controlled entities. Note: this changes the bridge's behavior, not PF2e's — the chat message tooltip still hides modifier breakdown for GM-only-owned PCs (PF2e's own rule); only the on-canvas dice visibility changes.
- **Damage-dialog actor lookup now class-aware.** Earlier `inferShowBreakdownFromDialog` walked `ctx.actor` first, which on damage rolls could pick up the target (NPC) instead of the source (PC), flipping the breakdown decision. Now we branch on `dialog.constructor.name`: `DamageModifierDialog` reads `ctx.self.actor` (the source); `CheckModifiersDialog` reads `ctx.actor` (the rolling actor); unrecognized dialog classes try both, in that order.

## 0.2.7 — 2026-05-03

### Features

- **Per-damage-type colorsets for task dice (DSN 6.0+ feature, made to work for PF2e).** Previously DSN's per-damage-type styling produced no effect for ~11 of PF2e's 16 damage types because DSN ships built-in colorsets named after D&D damage types (lightning, thunder, radiant, necrotic…) that don't match PF2e's tags (electricity, sonic, vitality, void, spirit, mental, bleed, slashing, piercing, bludgeoning, untyped). On startup the module now registers those missing PF2e-named colorsets in DSN's `br` registry under the `DICESONICE.DamageTypes` category, so they appear as configurable rows in `Module Settings → Dice So Nice → Damage Type Configuration` alongside DSN's built-ins, and apply automatically to per-flavor styled rolls. Each registered colorset has sensible defaults (electricity = electric yellow on ice, sonic = cyan on stone, vitality = warm gold on stone, void = dark purple on marble, …) — borrowed/adapted from `pf2e-dice-flavor-fix`'s palette so users don't have to manually configure to see distinct colors out of the box. Skipped automatically when `pf2e-dice-flavor-fix` is active. Toggle: client setting `registerPf2eColorsets` (default on).
- **Spawned task dice now respect the user's per-damage-type colorset.** When a damage roll dialog opens, the bridge extracts each die's damage type from `formulaData.base[].damageType` and passes it through DSN's `getAppearanceForDice(raw, dieType, {options: {type, flavor}})` to build the per-die appearance. The same flavor flows through every spawn path: opener-side task dice, secret-mirror receivers (each receiver builds appearance from THEIR own DSN settings, not the opener's), hidden-viewer ephemeral throw replays, and direct-Roll-button chat-message mirrors. Respects DSN's `enableFlavorColorset` toggle.

### Fixes

- **PF2e v8 nested `formulaData.base[].terms[]` not recognized — task dice spawned with no flavor.** Modern PF2e moved dice specs out of direct `diceNumber` / `dieSize` fields into a nested `terms[]` array (`{dice: {number, faces}, modifier?}`). The previous extractor read only the legacy fields, so for any v8 damage roll the slot's flavor was never set, and task dice spawned with the user's default appearance instead of the per-flavor colorset. Now reads `entry.terms[]` first and falls back to legacy fields. Affects both `attachDamageFlavors` (primary path, button-text-derived slots) and `slotsFromFormulaData` (fallback path used when the submit-button text isn't available yet).
- **`getAppearanceForDice` returns appearance with `colorset: undefined`.** DSN's colorset registry stores the name in a `name` field, not a `colorset` field. When `getAppearanceForDice` resolves a damage-type mapping it spreads `br[colorsetName]` into the result, leaving `colorset` undefined. Downstream `generateMaterialData` then uses `appearance.colorset` to re-look-up the colorset for "custom" fallbacks, finds undefined, and falls back to `br.custom` (= the user's customized default) — which then bleeds the user's default colors into the material despite the resolved appearance having the right `foreground` / `background` / `texture` directly. Symptom: persistent task die spawns with user's default appearance instead of the flavored colorset, even though `getAppearanceForDice`'s direct return values look correct in a debugger. Fix: write the colorset name back onto the result object via `base.colorset = base.name ?? flavor`.
- **Auto-submit broken after the user adds dice mid-dialog (e.g. clicking PF2e's "+ Add" button to attach a fire damage die to a piercing weapon attack).** Three subtle bugs converged here: ① our subscriber's `triggerSubmit` was using the `root` captured at injectTray time, but PF2e re-renders the dialog when the user adds dice, so by the time the auto-submit timer fired the `root` was a detached DOM tree — `submitBtn.click()` on a detached button doesn't dispatch the form's submit handler. Fix: query `app.element` (always the live root) instead. ② `store._autoSubmitted` was set on the previous shape's auto-submit attempt and never reset on shape change, so even if the new fill wave should have re-triggered, the guard blocked it. Fix: clear the flag in the `slotsShapeChanged` branch. ③ `bindMessageModeWatcher` short-circuited on every re-render via `store._modeWatcherBound`, so the message-mode change handler stayed bound to the original (now detached) `<select>` element and the live select had no listener. Fix: remove the guard, bind every render.
- **Hidden-viewer ephemeral mirrors lost flavor styling on healing rolls.** PF2e tags healing-capable rolls with a compound flavor like `[damage,healing,vitality]` instead of bare `[vitality]`. Our `createChatMessage` mirror path was passing this whole string as `flavor` to receivers, which DSN's `detectDamageType` returned verbatim, then `resolveDamageTypeMapping` failed the `br[flavor]` lookup because no colorset is named "damage,healing,vitality". The fix splits the flavor on commas and finds the first token that's a known PF2e damage type — bare flavors like "fire" pass through unchanged. Same parsing now applies to `roll.type` (which DamageInstance also exposes as the bare type) so it's preferred over the compound term.options.
- **PF2e compatibility version updated** from 7 to 8 in `relationships.systems` (current PF2e is 8.0.3).

### Diagnostics

New diagnostic API methods on `game.modules.get("pf2e-dsn-persistent-bridge").api` for support / debugging:

- `diagnose()` — overall module health (DSN active, libWrapper active, persistent dice setting, etc.) — pre-existing.
- `diagnoseFlavor(dieType, flavor)` — end-to-end colorset resolution check for a given die type + damage type. Reports DSN colorset registry coverage for all 16 PF2e damage types, the user's `enableFlavorColorset` state, the resolved appearance for a synthetic flavor query, and the user's raw default appearance.
- `diagnoseTaskDice()` — lists each task die currently on canvas with its damage-type tag and runtime material info.
- `diagnoseDialog()` — dumps the formulaData structure of any open PF2e check/damage dialog as readable JSON (button text, `base[].terms[]`, `dice[]`, etc.), so users (or future me) can verify our flavor extraction handles new PF2e formula structures.

### Cleanup

- **Removed ~110 lines of dead UI code from older slot-tray designs**:
  - `slot-store.js`: 4 unused methods (`toggleLock`, `clearSlot`, `clearAllUnlocked`, `rngAll`), the `releaseMeshClaim` helper that only those methods called, the unreachable `STATES.LOCKED` enum value, the never-used `forUser` / `getConsumedMeshIds` methods, and the never-called `PendingQueue.clear`. Plus the unused `MOD_ID` import. Net –73 lines.
  - `ui-injector.js`: per-slot lock binding (`[data-action="dsn-toggle-lock"]` querySelector that no template element matches) + `lockIcon` / `lockTooltip` per-slot data computation that the current template doesn't render. Net –14 lines.
  - `lang/en.json` + `lang/zh-CN.json`: 7 unused i18n keys (`tray.clearAll`, `clearAllTooltip`, `rngAll`, `rngAllTooltip`, `lock`, `unlock`, `resetSlotTooltip`).
  - `styles/dsn-bridge.css`: `.dsn-slot.state-locked` (state never reached at runtime), `.dsn-mini`, `.dsn-slot-controls`, `.dsn-slot:has(.dsn-slot-controls)` — none referenced in any template or runtime DOM.
- Slot state machine simplified: was `empty → filled → locked` with the `LOCKED` state reachable only via the now-removed `toggleLock`. Now just `empty → filled`.

## 0.2.6 — 2026-05-02

### Fixes

- **Task dice sometimes wouldn't get cleaned up after check rolls** (race condition, severe). The bridge tracks spawned task dice in `store._spawnedMeshIds`, but that array was only populated at the very end of the spawn loop. A user who closed the dialog faster than spawn could finish (~30–50 ms / die) — the typical "open check → click Roll immediately" pattern — left `_spawnedMeshIds=[]` at close time, so `cleanupTaskDiceForStore` early-returned and the mesh appeared on canvas after the dialog was gone, becoming an orphan that survived until the next dialog open swept it. Damage rolls were largely immune because users tend to pause and inspect the breakdown. Fixed two ways:
  - Cleanup now searches the live `persistentDiceList` by `dsnPF2eBridge_dialogId` tag instead of trusting `_spawnedMeshIds`. The tag is set synchronously right after each `await spawnPersistentDie` resolves, so meshes that finished spawning but hadn't been pushed to `_spawnedMeshIds` yet are still caught.
  - Spawn loop now carries a `_spawnToken` that gets bumped by `cleanupTaskDiceForStore` and any concurrent re-spawn (dialog re-render with changed slot shape). Each `await` checks the token; mismatch aborts the loop and self-cleans the just-spawned mesh, so the cleanup-then-respawn pattern from shape changes can no longer leak a stale spawn past the cleanup boundary.
- **Receiver-side secret-mirror cleanup race**. For secret rolls (self / blind / GM), the opener spawns local-only and emits `secret-mirror` socket messages so receivers spawn their own mirror meshes (real for those allowed to see the value, ghost for those who shouldn't). On dialog close, the opener emits `secret-mirror-cleanup`. If the cleanup arrived during the receiver's `await dice3d.spawnPersistentDie`, `removePersistentDie` couldn't find the mesh (it didn't exist yet) and silently no-op'd; the spawn then completed and the mesh became a permanent orphan on the receiver. Fixed by tracking recently-cleaned-up persistent IDs in a 5 s TTL Set; the spawn-completion path now checks this Set and self-removes if the cleanup arrived too early.
- **`inferTaskThrowBreakdown` used `_spawnedMeshIds`** for owner-dialog lookup, hitting the same end-of-loop timing bug as cleanup. A user throwing the first die before the last die finished spawning would see an empty match and fall back to `showBreakdown=true`, which leaked the real value on hidden-breakdown rolls (e.g. NPC checks with metagame breakdown off). Switched to walking `persistentDiceList` by `dsnPF2eBridge_dialogId` tag — same robustness as the cleanup fix.
- **PF2e critical-double dice setting (`pf2e.critRule="doubledice"`) wasn't honored.** On a critical hit with this setting, PF2e's `createDamageFormula(formulaData, degree)` doubles the dice count internally (`number * 2`, with `[doubled]` flavor — see `pf2e.mjs:592, 671`), so the rolled formula is `2dN` while `formulaData.dice[].diceNumber` still reads the base count. Our slot extractor read the base count and spawned only half the dice; the other half fell back to RNG. Fix: prefer parsing the rendered submit-button text (which contains the *final* formula PF2e will roll) over `formulaData` traversal.
- **Rule Element `override.diceNumber` with formula expressions wasn't parsed.** Examples: kineticist `"max(1 + floor((@actor.level - 1) / 4), 1)"`. The bridge ran `Number("max(...)")` → `NaN` → 0 slots; the second die appeared in chat (PF2e resolved the formula) but the user couldn't physically throw it. Same root cause and same fix as the doubledice issue — button text already has every transform PF2e will apply (RE formulas resolved, doubling applied, crit-only dice merged), so parse from there.
- **Crit-only bonus dice (deadly, fatal, scatter) used to spawn slots even on non-crit damage.** The old `formulaData.dice` traversal didn't filter `d.critical=true` entries by outcome, so a non-crit damage roll with a deadly weapon would show an extra empty d10 slot that PF2e never rolled. The button-text-first switch fixes this incidentally — non-crit damage formulas don't include crit-only terms.
- **`reroll-handler.js` referenced `SETTINGS.autoRemoveAfterConsume`** which was never registered. `getSetting(undefined)` always returned undefined, so the guard was effectively always-true — auto-remove always ran (the desired default), but the toggle could never be turned off. Removed the broken guard; auto-remove of spent dice after reroll harvest is now unconditional with rationale comment.
- **PF2e compatibility version updated** from 7 to 8 (current PF2e is 8.0.3).

### Cleanup

- **Removed dead `secret-display` socket branch** (~90 lines in `socket.js`). Was an alternative implementation for ceremonial blind/GM rolls (DSN-synced spawn + per-receiver hide) that got replaced by the cleaner secret-mirror path (local spawn + per-receiver mirror) but the old code stayed defined-but-uncalled. Deleted: `emitSecretDisplay` / `emitSecretDisplayCleanup` / `applySecretDisplay` / `applySecretDisplayCleanup` / `hideMeshSecretly` / `pendingDisplayHides` Map / a duplicate top-level `Hooks.on("dice-so-nice.persistentDiceChanged", ...)` / two router `case` branches. `socket.js` shrank from 296 → 210 lines.
- **Removed write-only flag `store._breakdownHidden`** in spawn-helper.js. Was set every spawn but never read anywhere — residue from the same architectural reshuffle.
- **Removed dead `targets` line in `hideMeshSecretly`** (broken filter expression `t && t !== mesh.parent || t` that simplified to `Boolean(t)`, with the result variable then unused).
- **Removed unused `DEFAULT_AUTO_SUBMIT_DELAY_MS` constant** in dsn-listener.js. Auto-submit delay is read from settings with a literal `1000` fallback in ui-injector.js, never via this dead constant.
- **Refreshed dsn-listener.js header comment** that still described an old polling-at-4 Hz strategy. Current implementation is hook-driven via `preCreateChatMessage` + `createChatMessage` + `settleAndScan`.

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
