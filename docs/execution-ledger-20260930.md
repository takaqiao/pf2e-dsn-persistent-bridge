# SDD ledger — plan: docs/superpowers/plans/2026-09-30-octagonal-tray.md

Execution approved: 2026-09-30, Native. Branch feature/octagonal-tray, base e06d403.
Workspace: existing dedicated restored repository, as the approved plan specifies; parent fvtt is excluded. Baseline: 25 scripts pass node --check; no existing test runner.

Pre-flight: Task 1 → Tasks 2/3/5/6: Session token/getters and once-only snapshot agree.
Pre-flight: Task 2 → Task 6: exact binding, UI cleanup separate from submitted handoff; callback signatures agree.
Pre-flight: Task 3 → Tasks 4/5/6: adapter canvas/box generation and owned record agree; runtime source checks will pin private APIs.
Pre-flight: Task 4 → Tasks 5/6: view element used by gestures; onState adds action feedback without changing Roll.
Pre-flight: Task 5 → Task 6: Dispose cancels held gestures before adapter teardown.
Pre-flight: Task 6 → Task 7: diagnostics omit private values; live checks require real runtime evidence.

Task status: 0.5.0 Tasks 1–7, final review, one fix pass and local candidate packaging complete. The user-approved 0.5.1 amendment is in progress; its tests, browser evidence and candidate packaging must be recorded separately. Entries through Final cleanup below are historical 0.5.0 evidence.

Task 2: Ruling: onDialog returns Session|null so the observer can bind the exact identity immediately; the plan's void callback omitted that handoff. Added optional onSubmit/onEvaluated callbacks for freezing and cleanup. Cost if wrong: a physical session could remain unbound; binding and close regression tests pin the contract.
Task 2: Descriptor retains cloned termOptions/termModifiers for the player's native appearance; deferred persistent damage is excluded from displayed inputs and remains native RNG.

Task 3: Native queue copies only known fields, so metadata uses WeakMap<Mesh,batch>; queue success requires new pt+sim+forced faces and successful completion. onFailure(token) resets failed gestures instead of leaving a flying session. Actor ID is carried to current native appearance flags. Compound secondary failure RED→GREEN now removes physical mesh and ownership.
QA preparation: independent runtime/software/dataPath ready, setup PID1649859, production PIDs unchanged. Local SSH tunnel PID62884. Browser license page opened; owner authorization requested asynchronously, implementation continues.
Task 1: complete (commits e06d403..eeb22be, tests: npm test → ℹ duration_ms 73.7494)
Task 2: complete (commits eeb22be..4fecb14, tests: npm test → ℹ duration_ms 167.6773)
Task 3: complete (commits 4fecb14..25b37e5, tests: npm test → ℹ duration_ms 167.662)
Task 4: Ruling: use native box.ready (not readyPromise), preserve synchronous _buildDiceBox return, and replace canvas fade with fadeOutEphemeral without its clearAll callback — source proves clearAll cancels the native mesh fade; native fade already removes ephemeral lists/bodies — cost if wrong: ephemeral cleanup could differ in a later DsN version. Runtime capability guard and QA pin 6.4.1.
Task 4: complete (commits 25b37e5..b4c58a6, tests: npm test → ℹ duration_ms 210.8559)
Task 5: Ruling: cancelGrab/removeSession accept an optional generation token and positionForSample maps the native camera ray through box.toPositionPct — late cleanup by dialog ID alone removed newer dice, and CSS fractions were not native world fractions — cost if wrong: an old constraint could remain; generation regression and browser QA cover this.
Task 5: complete (commits b4c58a6..047310d, tests: npm test → ℹ duration_ms 237.0103)
Task 6: Ruling: dependency parameters are factories, with fresh adapter/view instances on every enable — disposed resources cannot safely be re-enabled — cost if wrong: callers must provide factories; lifecycle harness pins the API. Keep a compact PF2e colorset/role registration because native 6.4.1 lacks eleven PF2e roles; existing choices win.
Task 6: complete (commits 047310d..006e675, tests: npm test → ℹ duration_ms 302.7758)
Task 7: Ruling: QA world ID is pf2e-dsn-bridge-qa and native fixtures use a trained +5 check, mixed 1d8+3 slashing/1d6 fire and 3d6 bludgeoning/1d4 fire — native valid PF2e schema replaces illustrative plan numbers while exercising the same paths — cost if wrong: these counts need explicit evidence in QA. User explicitly authorized reusing the local license file and accepting EULA; overrides owner-only manual-entry plan preference, accepted via UI. QA PID1651200; production unchanged.
Task 7: Ruling: native guest queue has roll:null; derive logical values from its validated forced faces and borrow claimThrow with an isolated pending view — real throw landed without handoff, and native pending cards otherwise could claim task dice — cost if wrong: future guest RNG changes require adapter update; guest/no-other-card RED→GREEN regressions added. Actual DsN host is DIV, so static CSS targets the module class; hit layer stays below native dialogs so Roll remains reachable. Real hide RED display:none reproduced.
Task 7: Ruling: await native box.ready instead of checking inputHandler at the readiness hook; native none has ready:null and stays native-only — actual ready hook runs before the input controller exists — cost if wrong: later native lifecycle changes need guard updates. Bootstrap RED→GREEN proves delayed initialization and none.
Task 7: Ruling: remove only the landed generation and repaint mini dice while retaining Session values — manual submit must not leave re-grabbable physical instances — cost if wrong: the landed physical die disappears before the user inspects it; chat preserves confirmed values and native Roll consumes them. Manual-submit RED→GREEN and browser face15→total20 prove handoff.
Task 7: Ruling: normalize native messageMode ic to Session public; preserve gm/blind/self as native-only — actual Foundry14 values differ from illustrative private, and ic Roll becomes public natively — cost if wrong: future visibility enum changes require revalidation; real private payload count0 and ic/none test pin current behavior.
Task 7: Ruling: guest pendingId uses pd-session: prefix and only those remote native events wait in order for cold model creation — real first reception could drop a throw before its mesh exists — cost if wrong: native protocol changes could delay remote guest events; RED→GREEN and 1500ms delayed actual create prove correct face13, mine visibility restoration and cleanup.
Task 7: Ruling: QA tools cannot emit a sustained native keyDown/keyUp; keyboard long hold, blur and unsupported blast/inline UI retain unit/source evidence only, explicitly listed as unverified browser cases — core mouse/native/privacy/multiplayer flows are tested and candidate is local-only — cost if wrong: these less common paths need owner runtime confirmation before release.
Task 7: complete (commits 006e675..6ae982d, tests: npm test → ℹ duration_ms 328.6423)
Final: reviewed base e06d403..6ae982d once, fresh gpt-6-astra xhigh. Critical none; both integration findings remain Important by effect, initial light palette remains Minor.
Final: Ruling: compatibility beyond Foundry14.368/PF2e8.5.1/DsN6.4.1 was declined by reviewer — candidate support stays bounded to the tested runtimes; native guards handle unavailable contracts — cost if wrong: another version can require an adapter update and fresh browser verification.
Final: Ruling: public release and long-duration GPU/memory behavior were declined by reviewer — deliver the authorized local candidate, with remaining live matrix and extended resource measurements explicitly pending — cost if wrong: long-session resource use or untested interaction failures may require further fixes before publishing.
Final: minor (deferred): initial light theme does not apply light tray material colors until a later body class mutation.
Final: fixed replacement canvas losing tray visibility/observation — replacing both canvas and box transfers tray visibility protection and removes it on teardown / box-change layout moves canvas observation to the replacement host RED→GREEN, suite 97/97. Actual viewport resize replaces both objects, removes old class, new class present, native hideFX:none inline none still computed block/opacity1.
Final: fixed mine visibility affecting unrelated decorative throws — mine mode keeps unrelated foreign decorative dice hidden without collision overrides RED→GREEN, suite 97/97. Actual native decorative replay PL visible=false; task replay visible=true; both clients face9+5=14, same message goKdK4Mv7SBRMypO, cleanup0. Empty tray idle5sec tickerAdd0/playStep0.
Final: packaged local candidate 0.5.0, 18 files, 34634 bytes, SHA256 63f892f6f7469044d3eb815ab97d50a3532f4c246e38eb1e89a04282767a78fe. Verified archive and manifest entry points. QA PID1653769 and tunnel62884 stopped; production PIDs688349/1621366 still running. Keep feature/octagonal-tray as approved; no push/release/production install.
Final cleanup: automatic approval review rejected removing this plan temporary workspace as blocked by policy. The ignored directory is retained; committed ledger and local candidate are unaffected.

## User-approved amendment — 0.5.1 in progress

Authorization: the user approved local preparation/grab/growth/spin, native receiver animation when the PF2e chat result is created, retirement of remote persistent compatibility and ordinary fixed dice, a one-time GM migration disabling native fixed dice with saved flags preserved, a floor parallel to the canvas, and elapsed-time growth using the existing native ticker. Version 0.5.1 remains a local candidate; no release is authorized. The earlier remote-ordering/mine-replay Ruling and Final mine-visibility verification are superseded behavior, retained here as the history of 0.5.0.

Amendment A1: Ruling: keep task dice and their native preparation/pickup/pre-roll/throw/remove events local, then use PF2e chat synchronization for other players' native DsN animation; only the author remembers and suppresses the exact physical revision — cost if wrong: receivers wait for chat creation and changed native contracts could leak task events or duplicate/miss animations. Verify all native event types and both clients' results; spawn/remove synchronize=false alone is insufficient.

Amendment A2: Ruling: retire remote ordering, remote mine replay/collision adjustments and ordinary fixed-dice compatibility; a GM migrates world persistentDice=false once for 0.5.1 without deleting saved DsN dice flags — cost if wrong: ordinary fixed dice remain unavailable until separately restored, and native setting gates can also prevent local guest physics. Verify local task creation and data preservation after migration; do not treat retained flags as an active ordinary fixed-dice feature.

Amendment A3: Ruling: remove the tray group's extra tilt and retain native camera perspective, aligning its floor with the canvas — cost if wrong: projected depth and hit-area placement change. Recheck resize and overlap; no new octagonal collision system is introduced.

Amendment A4: Ruling: use about 150ms of actual elapsed time for growth, emit held once, and render growth through the existing native ticker — cost if wrong: slow frames jump to the current size, and an unavailable ticker can leave the change unseen. Measure preparation/growth timing and confirm cancellation; native spawn/constraint latency remains outside this optimization.

Documentation: bumped manifest version/download target to 0.5.1 and amended README, changelog and approved spec. Historical QA remains unchanged. This entry records approved decisions and documentation work only; it does not claim tests or 0.5.1 browser QA passed.

## Local amendment review — 2026-10-01

Review: one fresh independent read-only review of the 0.5.1 amendment, gpt-6-astra xhigh. Critical: none. Two findings retained as Important by effect. One implementer fix pass; no second review. Browser acceptance remains in progress.

Amendment A5: Ruling: enable the native per-box gate only for local guests with matching pd-session: prefix/reserved user/owner, clear original restored meshes locally without touching flags/socket, catch late restoration via persistentDiceChanged, and restore the current world setting on dispose. Give task dice stable pd-die:<userId>:<UUID> native remotePersistentId values; isolate persistentId(s) and positions[].persistentId even after ownership cleanup, skip empty move events, drop invalid task throws before RNG, and drain release/move Promises before uninstalling isolation — cost if wrong: native gate/event/worker contracts may require an adapter update, and disposal waits for native operations. Fresh browser checks are still required.

Amendment A6: Ruling: determine completeness from the identity Set of actual injected die-result objects, remember only local complete revisions, and suppress author animation only when all dice-bearing Rolls in a message qualify. Partial/mixed messages and enabled visible inline RNG results retain the complete native animation — cost if wrong: physical dice already shown locally can replay. Hidden/disabled inline animation does not force replay. This narrows A1 and preserves visible RNG results.

I1 fixed: stable task IDs outlive the ownership map; async native release, pickup and move events remain isolated through scene cleanup and disposal. Three asynchronous-event regressions were RED then GREEN; the native positions[] move payload regression was added RED then GREEN as well. Invalid task throws are stopped before native RNG.

I2 fixed: enabled visible inline RNG results alongside complete physical Rolls no longer lose native animation. The regression covering enabled, disabled and hidden inline results was RED then GREEN. Partial and mixed-message suppression follows A6.

Verification reported by the implementer: npm test 109/109, npm run check and git diff --check passed after the one fix pass. This is code-level evidence, not a declaration that 0.5.1 browser acceptance passed. Detailed disposition: [final-review-local-20261001.md](final-review-local-20261001.md).

Minor (deferred): README/CHANGELOG's duplicate-animation promise lacks the partial/mixed qualification. Keep the original sentences under the executing-plans Minor rule; A6 records the practical tradeoff. The existing initial light-theme palette issue remains deferred.

Final: minor (deferred), D1: initial light clients retain dark tray colors until a later body-class change; this is the existing Minor, not a new ruling.

Declined to judge D2: Ruling: matching directions/collisions between local hand motion and remote native chat animation, and an octagonal collision simulator, are outside the approved scope — cost if wrong: clients see different trajectories/collisions while the reported results must still agree.

Declined to judge D3: Ruling: elemental blast, inline damage and windowless paths remain native-only — cost if wrong: no manual tray interaction for those entries; native rolling is still available.

Declined to judge D4: Ruling: browser QA follows the implementer's actual evidence and long-duration GPU/memory behavior remains unclaimed — cost if wrong: remaining live cases and long-session resources require manual verification and may need more fixes. Historical QA remains historical.

Declined to judge D5: Ruling: support remains bounded to Foundry 14.368/PF2e 8.5.1/DsN 6.4.1; no other-version compatibility claim — cost if wrong: a later version may require adapter changes and new runtime checks. Reaffirms the earlier compatibility boundary.

Declined to judge D6: Ruling: release/push/production installation are not authorized, so retain the local candidate — cost if wrong: publication and deployment wait for authorization and remaining verification. Reaffirms the earlier release boundary.

Final local QA: bounded 0.5.1 browser acceptance completed in the isolated world; Fortune10/18→23 and mixed6/1/2/1→10 agree on both clients. Held receiver persistent0; all local persistent socket events0; sender chat animations0, receiver one per public message; cleanup0. Native Blind17 and public Fortune20 button paths have revision=null. Reload with world fixed dice=false and actual box/host replacement retain one tray; old gate=false/new gate=true. Idle5s tickerAdd0/playStep0. Growth renderScene44→3; warm single grab13.2ms, cold native creation220–330ms remains. RAF did not prove smooth150ms visual completion. See docs/qa-local-20261001.md and ignored QA evidence.

Final local verification: npm test109/109, npm run check, git diff --check pass after the final per-box closure adjustment. Two Important fixes use RED→GREEN, no re-review. Temporary observations and viewport restored; QA PID1668423/tunnel6108 stopped; production PIDs688349/1621366 still running. Branch remains feature/octagonal-tray; no release, push or production install. Previously rejected temporary-workspace deletion was not retried.
