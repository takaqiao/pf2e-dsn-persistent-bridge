# Final review — 2026-09-30

Fresh independent reviewer: gpt-6-astra, xhigh, read-only; reviewed e06d403..6ae982d once. Independently ran 94/94 tests and syntax/manifest checks. No second review was dispatched; the implementer verified the one fix pass with failing regressions and 97/97 final tests.

## Reviewer strengths

- Identity uses reference carriers rather than formula matching or a next-roll queue. Generation tokens protect late spawn/landing callbacks.
- Values are validated against descriptors, injected through individual dice, and restored in finally. Rerolls clear the previous marker.
- Suppression precedes native queue merging, preserving unrelated carriers.
- Substantial legacy machinery is removed; QA distinguishes live evidence from unit coverage.

## Findings and disposition

Critical: none found.

Important: actual DsN resize replaces both host and box. Tray group reattached, but the replacement lacked pd-tray-mounted and the view observed the old host, so native hideFX:none or click hiding could hide the idle tray. Fixed: transfer the mounted class and move observation during layout. Two focused regressions failed first, then passed. Live replacement, class transfer and native hideFX:none passed (inline display:none, computed display:block, opacity1).

Important: mine-mode replay exception included unrelated foreign decorative dice, enabling their visibility and collisions. Fixed: require the pd-session: guest marker before overriding native visibility. The regression failed with visible=true before the fix, then passed with false and zero collision overrides. Real native decorative throw stayed hidden in PL mine; module public check remained visible during replay and both clients reported d20=9, total14, message goKdK4Mv7SBRMypO. Cleanup returned to zero.

Minor (deferred): initial light-theme colors are never applied on mount; dark palette remains until a later body-class mutation. This is recorded rather than included in the fix pass.

## Declined to judge and implementer rulings

Compatibility beyond Foundry14.368/PF2e8.5.1/DsN6.4.1 lacked matching runtime evidence. Candidate claims stay bounded to tested versions. Cost if wrong: later versions can need adapter changes and fresh live checks.

Public-release readiness and long-duration GPU/memory behavior lacked a completed live matrix and extended measurements. Deliver a local candidate with remaining verification explicit. Cost if wrong: extended-session resource use or untested interactions need more fixes before publication.

Reviewer assessment: ready with fixes. Implementer disposition: both Important findings fixed, 97/97 tests, syntax/manifest and diff checks passed; release prerequisites remain documented in QA.
