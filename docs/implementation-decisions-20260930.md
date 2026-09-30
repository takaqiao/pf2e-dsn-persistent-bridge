# Implementation decisions — 2026-09-30

Approved plan: docs/superpowers/plans/2026-09-30-octagonal-tray.md. Local candidate only.

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

Task 7: Ruling: QA tools cannot emit a sustained native keyDown/keyUp; keyboard long hold, blur and unsupported blast/inline UI retain unit/source evidence only, explicitly listed as unverified browser cases — core mouse/native/privacy/multiplayer flows are tested and candidate is local-only — cost if wrong: these less common paths need owner runtime confirmation before release.

Final: Ruling: compatibility beyond Foundry14.368/PF2e8.5.1/DsN6.4.1 was declined by reviewer — candidate support stays bounded to the tested runtimes; native guards handle unavailable contracts — cost if wrong: another version can require an adapter update and fresh browser verification.

Final: Ruling: public release and long-duration GPU/memory behavior were declined by reviewer — deliver the authorized local candidate, with remaining live matrix and extended resource measurements explicitly pending — cost if wrong: long-session resource use or untested interaction failures may require further fixes before publishing.

