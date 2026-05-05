# PF2e × DSN Persistent Dice Bridge

[![GitHub release](https://img.shields.io/github/v/release/takaqiao/pf2e-dsn-persistent-bridge?style=flat-square&label=release&logo=github)](https://github.com/takaqiao/pf2e-dsn-persistent-bridge/releases/latest)
[![Foundry version](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fversion%3Furl%3Dhttps%3A%2F%2Fgithub.com%2Ftakaqiao%2Fpf2e-dsn-persistent-bridge%2Freleases%2Flatest%2Fdownload%2Fmodule.json&style=flat-square)](https://foundryvtt.com/packages/pf2e-dsn-persistent-bridge)
[![Total downloads](https://img.shields.io/github/downloads/takaqiao/pf2e-dsn-persistent-bridge/total?style=flat-square&label=downloads&color=brightgreen)](https://github.com/takaqiao/pf2e-dsn-persistent-bridge/releases)
[![Latest downloads](https://img.shields.io/github/downloads/takaqiao/pf2e-dsn-persistent-bridge/latest/total?style=flat-square&label=latest)](https://github.com/takaqiao/pf2e-dsn-persistent-bridge/releases/latest)
[![Foundry VTT](https://img.shields.io/badge/Foundry%20VTT-v13%20%7C%20v14-orange?style=flat-square&logo=foundryvirtualtabletop&logoColor=white)](https://foundryvtt.com/)
[![Pathfinder 2e](https://img.shields.io/badge/system-PF2e-c1272d?style=flat-square)](https://foundryvtt.com/packages/pf2e)
[![Dice So Nice](https://img.shields.io/badge/Dice%20So%20Nice-required-7b3f99?style=flat-square)](https://foundryvtt.com/packages/dice-so-nice)
[![libWrapper](https://img.shields.io/badge/libWrapper-required-7b3f99?style=flat-square)](https://github.com/ruipin/fvtt-lib-wrapper)
[![License: MIT](https://img.shields.io/github/license/takaqiao/pf2e-dsn-persistent-bridge?style=flat-square)](LICENSE)

A Foundry VTT module that lets you use **Dice So Nice persistent dice you physically throw on the canvas** as the input for **PF2e** roll dialogs (skill checks, attack rolls, damage rolls, rerolls).

When you open a PF2e roll dialog the module spawns the exact dice you need on the canvas; you drag and throw them; the result feeds the dialog's slots; the roll auto-submits. The PF2e check / damage chat message is the only message you see — the dice are physical, not RNG.

## How it works

1. Open any PF2e roll dialog (skill check, attack, damage, reroll).
2. The module auto-spawns the needed task dice (`1×d20` for a check, `1d8 + 2d6` for damage, etc.) on the canvas, locked to you.
3. Throw them physically with DSN's drag-and-flick.
4. Wait for the dice to settle visually.
5. Slots fill, dialog auto-submits, PF2e posts the result.

Decorative dice you spawn manually are untouched — they remain free toys, never pulled into a roll.

## Features

- **Auto-spawn** task dice matching the roll's formula (any number of any face count).
- **Owned-only consumption** — only module-spawned task dice feed slots; your decorative dice are safe.
- **Decorative dice hidden** during a dialog so the canvas only shows what you need to throw.
- **Locked to dialog opener** — DSN's own `userData.lockedBy` field is set + socket-synced so other players cannot drag your task dice. One-click to unlock for the current dialog.
- **Auto-submit** when all slots fill, with a tunable settle buffer so the message appears only after the dice visibly stop.
- **Suppresses the redundant DSN throw message** during a dialog (the PF2e result message is the single chat output).
- **Reroll support** via `pf2e.preReroll` — throw your reroll die first, then click reroll.
- **Partial submission** — empty slots fall back to PF2e's RNG, so you can throw some dice and let others auto-roll.
- **Result injection** uses per-Die `_roll` patching, so PF2e modifiers (`kh`, `kl`, `r1`, `xo`, `min`, `max`) all work correctly.

## Requirements

- **Foundry VTT** v13 or v14
- **PF2e system** v7+
- **Dice So Nice!** v6.0.0+ (with `Persistent Dice` and `Allow Interactivity` enabled in DSN settings)
- **libWrapper** module (auto-prompt on install if missing)

## Installation

In Foundry's module browser, paste this manifest URL:

```
https://github.com/takaqiao/pf2e-dsn-persistent-bridge/releases/latest/download/module.json
```

## Settings

| Setting | Default | Effect |
|---|---|---|
| Enable bridge | on | Master toggle |
| Auto-spawn task dice | on | Spawn needed dice when a dialog opens |
| Only consume module-spawned dice | on | Decorative dice are not pulled into rolls |
| Hide decorative dice during dialog | on | Visually hide other persistent dice while a dialog is up |
| Lock task dice to dialog opener | on | Other players can't drag your task dice |
| Suppress standalone DSN throw message | on | Only the PF2e result message appears during a dialog |
| Auto-submit when all slots filled | on | Roll the dialog automatically once full |
| Auto-submit delay (ms) | 1000 | Pause between slot fill and submit |
| Settle buffer (ms) | 3500 | Extra wait for dice to visually stop |
| Apply to rerolls | on | Hero point / fortune rerolls also use canvas dice |
| Require all slots filled | off | If on, partial fills fall back to full RNG |
| Consume any player's dice | off | Cooperative-play mode |

## Limitations / known gaps

- **Reroll** uses a "throw first, then click reroll" workflow — `pf2e.preReroll` is synchronous so we can't open a wait-prompt dialog mid-reroll.
- **d100** is supported via DSN's link-group dice (one tens d10 + one ones d10 wired together); confirmation on edge cases (special PF2e d100 modifiers) is welcome.
- The module is system-locked to PF2e and intentionally does nothing on other systems.

## License

MIT — see [LICENSE](LICENSE).

## Credits

Built on top of:
- [Dice So Nice!](https://gitlab.com/riccisi/foundryvtt-dice-so-nice) by Simone Ricciardi & JDW
- [Pathfinder Second Edition](https://github.com/foundryvtt/pf2e) system
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper) by ruipin
