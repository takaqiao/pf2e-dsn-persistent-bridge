# Persistent Dice 0.5.3 QA — 2026-10-01

## Environment and method

Real clients used Foundry 14.368, PF2e 8.5.1 and libWrapper 1.13.5.1 in the isolated `pf2e-dsn-bridge-qa` world. Native DsN 6.4.1 was tested first; the QA installation was then updated from its official package to 6.4.2. Production retains 6.4.1.

The responsive player client was the Codex in-app Chromium browser. A second Chrome client received public chat animations. Chrome's automation window delivered roughly one animation frame per second even for native controls; its frame rate is not evidence about the module's normal rendering speed. The player client delivered native held-dice render intervals of about 17.5 ms.

Timing starts at the drag that lifts an already prepared tray batch and ends when the native constraints have been created. It excludes the intentional long press, preparation while opening the dialog, and the subsequent 150 ms growth. These are bounded local measurements, not a hardware-independent latency guarantee.

## Grab performance

| Case | Drag to held | Evidence |
| --- | ---: | --- |
| Original 0.5.2, first single die, Chrome | 317.7 ms | Material creation 259.3 ms; render 50.4 ms; two long tasks |
| Original 0.5.2, warm single die, Chrome | 9.0 ms | No grab long task |
| Native texture cache and shader preparation, single die, Chrome | 20.8 ms | Material creation 2.2 ms; no grab long task |
| 0.5.3, two d20s, responsive player client | 6.3 ms | Native constraints, no extra rendering loop |
| 6.4.2, first 3d6 bludgeoning + 1d4 fire, before palette fix | 142.1 ms | Fire randomly chose another material; d4 creation 120.6 ms, 119 ms long task |
| 6.4.2, fresh client, same four dice after palette fix | 12.4 ms | d4 creation 1.4 ms; no long task in the first 350 ms |

Previews now use the native persistent-dice cache at the physical dice scale. Native board shaders are compiled against the board's actual render target before the batch becomes ready. The renderer target is restored synchronously before waiting for compilation.

A preview's selected palette fields are reused for the same descriptor's physical spawn. Fresh role, system and library resolution still occurs. The cache is weakly keyed by descriptor and checked against the box generation and raw appearance. It does not prebuild every possible palette variant. GLB meshes without material data, material arrays, per-face texture arrays and themed `none` textures retain the native path; those custom cases have no measured cold-grab guarantee here.

The tray remains disabled and marked busy until its previews and preparation complete. It adds no WebGL context, animation loop, idle physics body or preparation broadcast.

## Interaction, direction and results

- Miniatures use seeded positions and yaw. They vary between batches and stay still within a batch. Their camera matches the tray's approved 55° desktop view and 35° FOV; native throw projection is unchanged.
- Held dice have no pre-roll rotation. Native body velocity is reset once, and mutual collisions are disabled only for the held batch. Four held dice retained identity parent quaternions; two held dice also remained still while an unrelated native animation finished. Collisions are restored before the physical throw and on cancellation.
- A gentle 4 px release produced the expected rightward direction under 6.4.1. Four-die downward release under 6.4.2 likewise carried `{x:0,y:1}` into the Roll, both Die terms and the receiver's native vectors.
- A stationary four-die release under 6.4.2 selected one random direction. The physical results were d6 `[2,6,5]` and d4 `[2]`, total 15. The receiver got one four-die native animation with the same results and direction. No persistent-dice event was broadcast. Both clients finished with zero sessions, dialogs and owned task dice.
- Native spread, collisions, camera and per-client settings remain active. Remote paths are approximate, not synchronized physics. Native supplemental dice in a partially physical Die term share that term's direction.
- The native blind Roll button completed normally with no physical completion or direction metadata. A held two-die batch canceled with Esc produced no chat message, held constraint or task body.
- The public native Roll button also completed normally (total 17), without physical completion or direction metadata. A final gentle 4 px upward release gave total 12 and `{x:0,y:-1}` on all four receiver dice.
- Repeated focus during preparation was tested with the first shader wait delayed by 750 ms. Eight preview compilations finished out of order; the visible four material UUIDs matched those used for the grab. This grab took 13.6 ms with no grab long task.
- Unit coverage includes private/native fallback, keep-highest/lowest, partial physical results, compound dice, concurrent cleanup, old box generations, mouse-up ordering and unrelated native grabs during task SFX.

## Resource checks

Thirty native mixed-damage dialogs were opened and closed without rolling. Geometry count stayed 21 and native scene children stayed 4. Texture count rose from 22 to 34 while the finite fire palette warmed, then stayed 34 from round 20 to round 30. Every sampled close had zero sessions, dialogs and task bodies; message count remained 57.

The same client then idled for 99.1 seconds. DsN renderer calls and physics-worker requests both remained zero; geometry, texture and scene-child counts did not change.

The measurements and browser probes are kept under ignored `qa/` files. Fixtures and diagnostic probes are excluded from the release ZIP.

The final code suite has 177 passing tests. Syntax, manifest, language and entry-point checks pass. Independent review found no remaining blocking issue; its overlapping-preview material race was fixed and covered by both a regression test and the browser check above.

## Visual and validation scope

The approved shallow octagon, equal-height rim, bevels, sloping inner walls, walnut frame, wine liner and narrow brass remain as documented in [the tray QA](qa-tray-20261001.md). The wood asset is 1254 × 1254, not the suggested 2048 × 2048, and is mapped once per rim side rather than advertised as a seamless tile. Native bloom on physical dice is not reproduced in static tray previews.

This record covers the isolated native fixture and source-level integration checks. Installing and enabling the release in the five production worlds does not imply a live regression run against every enabled third-party module in each world.
