## Install

In Foundry → **Add-on Modules → Install Module**, paste this manifest URL:

```
https://github.com/takaqiao/pf2e-dsn-persistent-bridge/releases/latest/download/module.json
```

## Requires

- Foundry VTT 14.361+ (verified 14.368)
- PF2e with the required native interfaces (verified 8.5.1)
- Dice So Nice! 6.4.1+
- libWrapper module

Version 0.5.5 removes the PF2e minimum-version gate while retaining the
system identity and native interface checks. A full PF2e 8.6.0 world session
has not been verified.

The octagonal tray replaces the old fixed-dice controls. Open a native PF2e
check or damage dialog, hold and drag out the dice, then release to roll.
Held dice stay still; a gentle drag supplies the direction, and a stationary
release chooses a random direction. Other players see the native DsN animation
when the public chat result appears.

DsN's native interactivity setting can stay disabled. Version 0.5.4 fixes
the tray failing to appear with that setting off, without changing it.

Previews warm the native material and shader cache and use a static random
arrangement. Preparation stays local and adds no idle physics or rendering loop.

See the [README](https://github.com/takaqiao/pf2e-dsn-persistent-bridge#readme) for what's included and the [CHANGELOG](https://github.com/takaqiao/pf2e-dsn-persistent-bridge/blob/v0.5.5/CHANGELOG.md) for what changed in this release.
