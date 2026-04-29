import { MOD_ID, log, warn } from "./constants.js";
import { registerSettings } from "./settings.js";
import { compat } from "./compat.js";
import { installEvaluateWrapper } from "./evaluate-wrapper.js";
import { onRenderCheckDialog, onRenderDamageDialog, onCloseDialog } from "./ui-injector.js";
import { startDsnListener } from "./dsn-listener.js";
import { onPreReroll } from "./reroll-handler.js";
import { registerDsnSuppressor } from "./dsn-suppressor.js";
import { registerSocket } from "./socket.js";

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
