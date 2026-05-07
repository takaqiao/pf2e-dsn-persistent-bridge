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
import { installShakeSensitivity } from "./shake-sensitivity.js";
import { installRestrictPersistentSpawn } from "./restrict-persistent-spawn.js";
import { maybeShowWelcome } from "./welcome.js";
import { registerPf2eColorsets } from "./pf2e-colorsets.js";

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
  // Shake-to-throw sensitivity override. Patches DSN's hardcoded threshold
  // of 5 with our user-configurable 1–10. Same prototype-patch pattern.
  installShakeSensitivity();
  // Block players from spawning their own decorative persistent dice via
  // DSN's toolbox. Bridge task-die spawns bypass via `_dsnBridgeAllowed`
  // marker on opts. GM is always allowed.
  installRestrictPersistentSpawn();
  // Register colorsets for PF2e damage types DSN doesn't ship by name
  // (electricity / sonic / vitality / void / spirit / mental / bleed /
  // slashing / piercing / bludgeoning / untyped). DSN's damageTypeMap
  // lookup falls back to the colorset registry when no per-type override
  // is configured, so registering these makes per-flavor styling actually
  // work for PF2e users out-of-box. `diceSoNiceReady` ensures dice3d
  // exists; `addColorset` is idempotent here via our `existing` check.
  if (game.dice3d) {
    registerPf2eColorsets();
  } else {
    Hooks.once("diceSoNiceReady", () => registerPf2eColorsets());
  }
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
      /**
       * End-to-end diagnostic for the per-damage-type colorset path.
       * Reports: which PF2e damage types are in DSN's br registry; what
       * the resolved appearance object looks like for a given dieType +
       * damage type; and whether `enableFlavorColorset` is on.
       *
       * Usage in console:
       *   game.modules.get("pf2e-dsn-persistent-bridge").api.diagnoseFlavor("d6", "fire")
       *   game.modules.get("pf2e-dsn-persistent-bridge").api.diagnoseFlavor("d6", "vitality")
       */
      /**
       * Inspect spawned task dice on canvas — check whether the bridge
       * actually tagged each one with its damage type, and what the
       * mesh's runtime material name looks like.
       */
      diagnoseTaskDice() {
        const list = game.dice3d?.box?.persistentDiceList ?? [];
        const taskDice = list.filter((m) => m?.userData?.dsnPF2eBridge_owned === true);
        const report = taskDice.map((m) => ({
          dieType: m.notation?.compositeType ?? m.notation?.type,
          persistentId: m.userData?.persistentId,
          flavorTag: m.userData?.dsnPF2eBridge_flavor ?? null,
          ownerUserId: m.userData?.ownerUserId,
          materialColor: m.material?.color?.getHexString?.(),
          materialName: m.material?.name,
          materialUuid: m.material?.uuid,
        }));
        console.log(`[pf2e-dsn-persistent-bridge] ${taskDice.length} task die(s) on canvas:`, report);
        return report;
      },
      /**
       * Inspect the currently-open damage/check dialog to see what
       * formulaData / button-text structure PF2e is exposing so we can
       * verify our flavor extraction logic.
       */
      diagnoseDialog() {
        const allApps = foundry?.applications?.instances ?? new Map();
        const dialogs = [];
        for (const [, app] of allApps) {
          const cls = app?.constructor?.name;
          if (cls === "CheckModifiersDialog" || cls === "DamageModifierDialog") {
            dialogs.push(app);
          }
        }
        if (dialogs.length === 0) {
          // Fallback: scan ui.windows (V1 apps in older Foundry)
          for (const id in (ui.windows ?? {})) {
            const app = ui.windows[id];
            const cls = app?.constructor?.name;
            if (cls === "CheckModifiersDialog" || cls === "DamageModifierDialog") {
              dialogs.push(app);
            }
          }
        }
        if (dialogs.length === 0) {
          console.log("[pf2e-dsn-persistent-bridge] No PF2e dialog open. Open a damage roll dialog first.");
          return null;
        }
        const reports = dialogs.map((dialog) => {
          const root = dialog?.element?.[0] ?? dialog?.element;
          const btn = root?.querySelector?.("form.check-modifiers-content > button[type=submit]");
          const formulaData = dialog?.formulaData;
          return {
            class: dialog.constructor.name,
            isCritical: dialog?.isCritical,
            buttonText: btn?.textContent ?? "(no button)",
            formulaDataExists: !!formulaData,
            formulaDataKeys: formulaData ? Object.keys(formulaData) : null,
            base: formulaData?.base?.map((e) => ({
              diceNumber: e?.diceNumber,
              dieSize: e?.dieSize,
              damageType: e?.damageType,
              category: e?.category,
              terms: e?.terms?.map((t) => ({
                dice: t?.dice ? { number: t.dice.number, faces: t.dice.faces } : null,
                modifier: t?.modifier,
              })),
            })),
            dice: formulaData?.dice?.map((d) => ({
              diceNumber: d?.diceNumber ?? d?.override?.diceNumber,
              dieSize: d?.dieSize ?? d?.override?.dieSize,
              damageType: d?.damageType,
              enabled: d?.enabled,
            })),
            contextDamageType: dialog?.context?.damageType,
            contextOutcome: dialog?.context?.outcome,
            damageInstanceType: dialog?.damage?.roll?.instances?.[0]?.type,
            damageInstanceCount: dialog?.damage?.roll?.instances?.length,
          };
        });
        console.log(`[pf2e-dsn-persistent-bridge] ${dialogs.length} open dialog(s):`, reports);
        console.log("=== JSON ===");
        console.log(JSON.stringify(reports, (k, v) => {
          // Strip Foundry/PIXI/THREE objects from JSON output
          if (v && typeof v === "object" && (v.constructor?.name || "").match(/^(Actor|Token|Application|Scene|Roll|DamageInstance|Mesh|Object3D)/)) {
            return `<${v.constructor.name}>`;
          }
          return v;
        }, 2));
        return reports;
      },
      diagnoseFlavor(dieType = "d6", flavor = "fire") {
        const dice3d = game.dice3d;
        if (!dice3d) return console.log("dice3d not ready"), null;
        const Dice3DCls = dice3d.constructor;
        const factory = dice3d.DiceFactory;
        const colorsets = dice3d.exports?.COLORSETS ?? {};
        const PF2E_ALL = ["acid", "bleed", "bludgeoning", "cold", "electricity", "fire", "force", "mental", "piercing", "poison", "slashing", "sonic", "spirit", "untyped", "vitality", "void"];
        const colorsetCoverage = {};
        for (const t of PF2E_ALL) {
          colorsetCoverage[t] = colorsets[t] ? `✓ (${colorsets[t].category})` : "✗ MISSING";
        }
        const enableFlavor = dice3d.userConfig?.enableFlavorColorset;
        const damageTypeMap = tryGet("dice-so-nice", "damageTypeMap") ?? {};
        const raw = Dice3DCls.APPEARANCE(game.user);
        const term = { options: { type: flavor, flavor } };
        const resolved = factory.getAppearanceForDice(raw, dieType, term);
        const report = {
          enableFlavorColorset: enableFlavor,
          flavorFixActive: !!game.modules.get("pf2e-dice-flavor-fix")?.active,
          colorsetCoverage,
          damageTypeMapKeys: Object.keys(damageTypeMap),
          query: { dieType, flavor },
          resolved: {
            colorset: resolved?.colorset,
            foreground: resolved?.foreground,
            background: Array.isArray(resolved?.background) ? `[${resolved.background.length} colors]` : resolved?.background,
            texture: typeof resolved?.texture === "object" ? resolved?.texture?.name : resolved?.texture,
            material: resolved?.material,
            isGhost: resolved?.isGhost,
            system: resolved?.system,
            systemSettings: resolved?.systemSettings ? Object.keys(resolved.systemSettings) : null,
          },
          rawUserGlobal: {
            system: raw?.global?.system,
            colorset: raw?.global?.colorset,
            labelColor: raw?.global?.labelColor,
            diceColor: raw?.global?.diceColor,
          },
          rawDieType: raw?.[dieType] ? {
            system: raw[dieType].system,
            colorset: raw[dieType].colorset,
          } : null,
          // Check if a "basic" or PF2e-specific system might be intercepting
          knownSystems: factory ? Array.from(factory.systems?.keys?.() ?? []) : [],
        };
        console.log("[pf2e-dsn-persistent-bridge] diagnoseFlavor →", report);
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
