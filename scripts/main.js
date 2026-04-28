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
  log("ready: hooks active");
});
