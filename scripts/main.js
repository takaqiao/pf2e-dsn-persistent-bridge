import { MOD_ID, log, warn } from "./constants.js";
import { registerSettings } from "./settings.js";
import { compat } from "./compat.js";
import { installEvaluateWrapper } from "./evaluate-wrapper.js";
import { onRenderCheckDialog, onRenderDamageDialog, onCloseDialog } from "./ui-injector.js";
import { startDsnListener } from "./dsn-listener.js";
import { onPreReroll } from "./reroll-handler.js";
import { registerDsnSuppressor } from "./dsn-suppressor.js";
import { registerSocket } from "./socket.js";
import { installVisibilityPatch } from "./dsn-visibility.js";
import { sweepOrphanTaskDice } from "./spawn-helper.js";
import { startForeignMirrorCleaner } from "./foreign-mirror-cleaner.js";
import { installOpenerThrowHook } from "./ephemeral-mirror.js";
import { installRightClickThrow } from "./right-click-throw.js";
import { maybeShowWelcome } from "./welcome.js";

Hooks.once("init", () => {
  registerSettings();
  const loader = foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  loader?.([`modules/${MOD_ID}/templates/slot-tray.hbs`]);
  log("init complete");
});

Hooks.once("setup", () => {
  if (!compat.checkLibWrapper()) {
    warn("lib-wrapper missing — bridge inactive");
    return;
  }
  if (!compat.checkPF2e()) {
    warn("PF2e system not active — bridge inactive");
    return;
  }
  installEvaluateWrapper();
  log("setup: evaluate wrapper installed");
});

Hooks.once("ready", () => {
  if (!compat.isFullyReady()) {
    warn("dependencies not satisfied; UI will still render in disabled state");
  }
  Hooks.on("renderCheckModifiersDialog", onRenderCheckDialog);
  Hooks.on("renderDamageModifierDialog", onRenderDamageDialog);
  Hooks.on("closeCheckModifiersDialog", onCloseDialog);
  Hooks.on("closeDamageModifierDialog", onCloseDialog);
  Hooks.on("pf2e.preReroll", onPreReroll);
  registerDsnSuppressor();
  registerSocket();
  startDsnListener();
  installVisibilityPatch();
  // Initial sweep: a receiver client that picked up a broadcast task die
  // from another user's dialog and never saw the cleanup (e.g. that user
  // refreshed mid-dialog) would otherwise carry the orphan forever. Run
  // once on every client at startup so accumulated orphans get cleaned.
  try { sweepOrphanTaskDice(); } catch (e) { warn("startup orphan sweep failed", e); }
  // Receiver-side cleanup: when our visibility is "mine" / "none", remove
  // foreign task dice as soon as they've settled, so post-throw idle on
  // hidden-viewer clients drops to ~200 ms instead of "until opener closes
  // the dialog".
  startForeignMirrorCleaner();
  // Opener-side hook: when DSN broadcasts a throw event for one of our
  // task dice, also broadcast a `task-mirror-throw` socket message so
  // hidden-viewer receivers can play an ephemeral 3D throw animation
  // (since they removed the persistent mesh on receive).
  installOpenerThrowHook();
  // Right-click on an owned persistent die → throw it in a random
  // direction with min velocity (no shake required).
  installRightClickThrow();
  // First-time welcome: self-whispered chat message describing how to
  // use the module. Re-sends when WELCOME_VERSION changes in welcome.js.
  maybeShowWelcome().catch((e) => warn("welcome dispatch failed", e));
  // Expose a diagnostic helper so testers seeing the "DSN not active" banner
  // can run `game.modules.get("pf2e-dsn-persistent-bridge").api.diagnose()`
  // in the console and report exactly which check failed.
  const mod = game.modules.get(MOD_ID);
  if (mod) {
    mod.api = {
      diagnose() {
        const diag = compat.diagnoseDsn();
        const report = {
          ok: diag.ok,
          reason: diag.reason ?? null,
          dsnModuleActive: !!game.modules.get("dice-so-nice")?.active,
          dsnModuleVersion: game.modules.get("dice-so-nice")?.version ?? null,
          persistentDice: tryGet("dice-so-nice", "persistentDice"),
          allowInteractivity: tryGet("dice-so-nice", "allowInteractivity"),
          hasDice3d: !!game.dice3d,
          hasBox: !!game.dice3d?.box,
          hasPersistentManager: !!game.dice3d?.box?.persistentDiceManager,
          libWrapperActive: compat.checkLibWrapper(),
          systemId: game.system?.id,
        };
        console.log("[pf2e-dsn-persistent-bridge] diagnose →", report);
        return report;
      },
    };
  }
  log("ready: hooks active");
});

function tryGet(scope, key) {
  try { return game.settings.get(scope, key); }
  catch { return "<not registered>"; }
}
