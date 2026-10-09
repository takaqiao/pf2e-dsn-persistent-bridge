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

Version 0.5.6 replaces runtime Foundry and Dice So Nice version checks with
the native interfaces used by the bridge. PF2e roll targets and DsN preview,
input and physics interfaces are checked before wrappers are installed;
unsupported interfaces leave the native roll flow available.

Source review and 213 isolated regression tests cover Foundry 14.369,
PF2e 8.6.0 and Dice So Nice 6.4.4. Browser/WebGL rendering and multiplayer
world sessions on those versions have not been verified. The manifest keeps
its existing installation requirements and verified world-session labels.

The octagonal tray replaces the old fixed-dice controls. Open a native PF2e
check or damage dialog, hold and drag out the dice, then release to roll.
Held dice stay still; a gentle drag supplies the direction, and a stationary
release chooses a random direction. Other players see the native DsN animation
when the public chat result appears.

DsN's native interactivity setting can stay disabled. Version 0.5.4 fixes
the tray failing to appear with that setting off, without changing it.

Previews warm the native material and shader cache and use a static random
arrangement. Preparation stays local and adds no idle physics or rendering loop.

See the [README](https://github.com/takaqiao/pf2e-dsn-persistent-bridge#readme) for what's included and the [CHANGELOG](https://github.com/takaqiao/pf2e-dsn-persistent-bridge/blob/v0.5.6/CHANGELOG.md) for what changed in this release.
