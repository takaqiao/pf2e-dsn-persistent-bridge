# Implementation decisions — 2026-09-30

Approved plan: docs/superpowers/plans/2026-09-30-octagonal-tray.md. Local candidate only. The following Task 2–7 and Final entries record 0.5.0 decisions and evidence; the user-approved 0.5.1 amendment below governs current behavior.

Task 2: Ruling: onDialog returns Session|null so the observer can bind the exact identity immediately; the plan's void callback omitted that handoff. Added optional onSubmit/onEvaluated callbacks for freezing and cleanup. Cost if wrong: a physical session could remain unbound; binding and close regression tests pin the contract.

Task 4: Ruling: use native box.ready (not readyPromise), preserve synchronous _buildDiceBox return, and replace canvas fade with fadeOutEphemeral without its clearAll callback — source proves clearAll cancels the native mesh fade; native fade already removes ephemeral lists/bodies — cost if wrong: ephemeral cleanup could differ in a later DsN version. Runtime capability guard and QA pin 6.4.1.

Task 5: Ruling: cancelGrab/removeSession accept an optional generation token and positionForSample maps the native camera ray through box.toPositionPct — late cleanup by dialog ID alone removed newer dice, and CSS fractions were not native world fractions — cost if wrong: an old constraint could remain; generation regression and browser QA cover this.

Task 6: Ruling: dependency parameters are factories, with fresh adapter/view instances on every enable — disposed resources cannot safely be re-enabled — cost if wrong: callers must provide factories; lifecycle harness pins the API. Keep a compact PF2e colorset/role registration because native 6.4.1 lacks eleven PF2e roles; existing choices win.

Task 7: Ruling: QA world ID is pf2e-dsn-bridge-qa and native fixtures use a trained +5 check, mixed 1d8+3 slashing/1d6 fire and 3d6 bludgeoning/1d4 fire — native valid PF2e schema replaces illustrative plan numbers while exercising the same paths — cost if wrong: these counts need explicit evidence in QA. User explicitly authorized reusing the local license file and accepting EULA; overrides owner-only manual-entry plan preference, accepted via UI. QA PID1651200; production unchanged.

Task 7: Ruling: native guest queue has roll:null; derive logical values from its validated forced faces and borrow claimThrow with an isolated pending view — real throw landed without handoff, and native pending cards otherwise could claim task dice — cost if wrong: future guest RNG changes require adapter update; guest/no-other-card RED→GREEN regressions added. Actual DsN host is DIV, so static CSS targets the module class; hit layer stays below native dialogs so Roll remains reachable. Real hide RED display:none reproduced.

Task 7: Ruling: await native box.ready instead of checking inputHandler at the readiness hook; native none has ready:null and stays native-only — actual ready hook runs before the input controller exists — cost if wrong: later native lifecycle changes need guard updates. Bootstrap RED→GREEN proves delayed initialization and none.

Task 7: Ruling: remove only the landed generation and repaint mini dice while retaining Session values — manual submit must not leave re-grabbable physical instances — cost if wrong: the landed physical die disappears before the user inspects it; chat preserves confirmed values and native Roll consumes them. Manual-submit RED→GREEN and browser face15→total20 prove handoff.

Task 7: Ruling: normalize native messageMode ic to Session public; preserve gm/blind/self as native-only — actual Foundry14 values differ from illustrative private, and ic Roll becomes public natively — cost if wrong: future visibility enum changes require revalidation; real private payload count0 and ic/none test pin current behavior.

Task 7: Ruling: guest pendingId uses pd-session: prefix and only those remote native events wait in order for cold model creation — real first reception could drop a throw before its mesh exists — cost if wrong: native protocol changes could delay remote guest events; RED→GREEN and 1500ms delayed actual create prove correct face13, mine visibility restoration and cleanup.

Historical 0.5.0 only: this remote event-ordering ruling and its mine-visibility evidence are superseded by amendment A1/A2 below. They remain recorded to explain the earlier candidate, not as 0.5.1 support claims.

Task 7: Ruling: QA tools cannot emit a sustained native keyDown/keyUp; keyboard long hold, blur and unsupported blast/inline UI retain unit/source evidence only, explicitly listed as unverified browser cases — core mouse/native/privacy/multiplayer flows are tested and candidate is local-only — cost if wrong: these less common paths need owner runtime confirmation before release.

Final: Ruling: compatibility beyond Foundry14.368/PF2e8.5.1/DsN6.4.1 was declined by reviewer — candidate support stays bounded to the tested runtimes; native guards handle unavailable contracts — cost if wrong: another version can require an adapter update and fresh browser verification.

Final: Ruling: public release and long-duration GPU/memory behavior were declined by reviewer — deliver the authorized local candidate, with remaining live matrix and extended resource measurements explicitly pending — cost if wrong: long-session resource use or untested interaction failures may require further fixes before publishing.

## User-approved amendment — local candidate 0.5.1

The user approved local preparation/grab/growth/spin, native result animation for other players at chat creation, retirement of remote persistent compatibility and ordinary fixed dice, a one-time GM migration disabling native fixed dice while retaining saved flags, a floor parallel to the canvas, and growth driven by elapsed time with one held-state transition and no extra growth renders. This approval supersedes the corresponding 0.5.0 behavior; it does not authorize a public release. Existing QA results remain evidence for 0.5.0 only. New migration, local event isolation, receiver chat animation and performance checks are pending until fresh results are recorded.

Amendment A1: Ruling: keep tray task instances and all preparation/pickup/pre-roll/throw/remove events local; synchronize through the resulting PF2e chat message, and suppress duplicate chat animation only for the author who remembers that exact physical revision — the approved interaction no longer shows another player's hand preparation — cost if wrong: remote players wait until chat creation to see the roll, and changed native event/message contracts could cause a leaked task event or duplicate/missing animation. Fresh two-client payload and same-result checks must cover the complete native event path; spawn/remove synchronize=false alone is insufficient.

Amendment A2: Ruling: remove remote event ordering, remote mine replay/collision adjustments and ordinary fixed-dice compatibility; a GM migrates the DsN world persistentDice setting to false once for 0.5.1 while saved DsN dice flags remain intact — the approved scope is a local check tray plus native chat animation — cost if wrong: the world's ordinary fixed-dice feature becomes unavailable until separately restored, and upstream disabling of persistentDice may also gate the local guest physics API. The local task-dice path and saved-data preservation require fresh verification; rollback data is retained, not silently rewritten.

Amendment A3: Ruling: set the tray group tilt to zero so its floor is parallel to the canvas; retain native camera perspective and the existing octagonal floor/rim geometry — this matches the approved tabletop orientation — cost if wrong: the tray's projected depth and hit-area placement change, so resize and overlap must be checked again. No octagonal collision simulator is added.

Amendment A4: Ruling: compute growth from actual elapsed time over about 150ms, announce held once, and let the existing DsN ticker draw scale changes without explicit renders for each growth step — repeated held notifications previously cleared the preview and rendered the whole scene several times per step — cost if wrong: a delayed frame jumps to its elapsed-time size, and an unavailable native ticker could leave size changes unseen. This removes redundant work but does not claim to eliminate native mesh/worker preparation latency; before/after timing and cancellation checks are required.

## Review follow-up — 2026-10-01

Amendment A5: Ruling: open the native per-box persistent-dice gate only for local guests with the pd-session: prefix, matching reserved user and owner. Remove already restored bodies locally at ready and catch late restoration through persistentDiceChanged, without deleting saved flags or sending socket removals; teardown restores the current native world setting. Give each task die a stable pd-die:<userId>:<UUID> ID through native remotePersistentId, so event isolation survives ownership cleanup. Filter persistentId, persistentIds and positions[].persistentId, skip empty move payloads, reject invalid task throws before native RNG, and drain in-flight release/move operations before removing isolation — cost if wrong: native gate, event or worker contracts can change and require an adapter update; teardown may wait for an outstanding native operation. Regression coverage is necessary but does not replace live migration and lifecycle checks.

Amendment A6: Ruling: mark a Roll complete only when every actual die-result object belongs to the Set of injected physical results. Remember only locally displayed complete revisions; suppress author animation only when every dice-bearing Roll in the message qualifies. A partial Roll, a mixed message, or an enabled visible inline RNG result retains the whole native animation — cost if wrong: the author's already displayed physical dice can animate again in these cases. This narrows A1's suppression promise so RNG results remain visible; hidden or disabled inline animation does not force replay.

One fresh independent review found two Important issues: late task events could escape after ownership cleanup/teardown, and suppression could hide enabled visible inline RNG results in a complete physical message. One fix pass addressed both. Three asynchronous event cases and the additional native move-payload regression failed before the I1 fix and passed afterward; enabled/disabled/hidden inline cases covered I2. The implementer reported 109/109 tests, syntax/manifest checks and diff checks passing. No second review was dispatched. The [review record](final-review-local-20261001.md) describes the disposition; 0.5.1 browser acceptance is still in progress.

Minor (deferred): README/CHANGELOG state the duplicate-animation promise without the partial/mixed qualification. Their original sentences are retained under the executing-plans Minor disposition; A6 records the actual behavior. The initial light-theme palette issue remains deferred too.

Final: minor (deferred), D1: a client initially using the light theme sees dark tray colors until a later body-class change; this is the existing Minor, not a new ruling.

Review boundary D2: Ruling: identical hand/receiver trajectories, identical collisions across clients and an octagonal collision simulator are outside the approved design; receiver animations use native chat rendering — cost if wrong: clients see different directions and collisions despite using the same reported results.

Review boundary D3: Ruling: elemental blast, inline damage and windowless entries retain native-only handling — cost if wrong: those entries offer no manual tray interaction, while native PF2e rolling remains available.

Review boundary D4: Ruling: browser acceptance depends on the implementer's actual runtime evidence, and long-duration GPU/memory behavior is not claimed by this review — cost if wrong: the remaining live matrix and extended-session resource behavior need manual verification and may reveal further fixes.

Review boundary D5: Ruling: keep the compatibility claim bounded to Foundry 14.368, PF2e 8.5.1 and DsN 6.4.1; other versions were not judged — cost if wrong: another version can require native-contract changes and fresh tests. This reaffirms the earlier compatibility Ruling.

Review boundary D6: Ruling: keep this as a local candidate; release, push and production installation remain unauthorized — cost if wrong: publication and production use must await authorization and the remaining verification. This reaffirms the earlier release boundary.

