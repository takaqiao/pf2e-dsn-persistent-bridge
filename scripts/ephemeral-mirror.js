import { MOD_ID, log, warn } from "./constants.js";
import { SlotRegistry } from "./slot-store.js";
import { inferShowBreakdownFromDialog } from "./show-breakdown.js";

/**
 * Cross-client mirror for PF2e roll animations.
 *
 * Two emit paths on the opener side:
 *
 *   1. `pdm.onPersistentEvent("throw")` — fires the moment a persistent
 *      task die is thrown (drag-shake or right-click). We mirror right
 *      then, so receivers see the throw animation in sync with opener
 *      pulling the trigger, not seconds later after settle + chat.
 *
 *   2. `createChatMessage` — catches direct Roll-button clicks (no
 *      persistent throw) and any other PF2e roll that lands as a chat
 *      message without going through a task die. Skipped when the
 *      message's rolls have `_dsnPersistentSourced === true` (set by
 *      evaluate-wrapper) — those were already mirrored via path 1.
 *
 * Receiver side: spawn `game.dice3d.showForRoll(roll, game.user, false)`
 * with the predetermined value. Ghost flag (face = "?") is set when the
 * roll's `showBreakdown === false` and the receiver isn't the GM.
 *
 * `user = game.user` opts past DSN's `visibility==="mine" && user!==me`
 * gate. Setting ghost at three places (roll.ghost, roll.options.appearance,
 * term.options.appearance + showForRoll options arg) covers all the
 * codepaths DSN's DiceFactory inspects, so the "?" face survives any
 * appearance override the user's theme might apply.
 *
 * When to mirror (receiver):
 *   visibility == mine/none           → always mirror (DSN filter would hide)
 *   showBreakdown=false task throw    → always mirror (opener spawned
 *                                       local-only to avoid leaking real
 *                                       values to all-mode receivers)
 *   otherwise                         → skip (DSN normal flow shows it)
 *
 * Diagnostic logs are unconditional console.log so the cross-client
 * flow can be debugged without per-client setting toggles.
 */

const SOCKET_NAME = `module.${MOD_ID}`;
const TAG = "[PF2e×DSN mirror]";
const diag = (...a) => console.log(TAG, ...a);

let installed = false;
let pdmHookInstalled = false;

export function installOpenerThrowHook() {
  if (installed) return;
  installPdmThrowHook();
  Hooks.on("createChatMessage", onCreateChatMessage);
  installed = true;
  diag("opener hooks installed (pdm.throw + createChatMessage)");
}

function installPdmThrowHook() {
  if (pdmHookInstalled) return;
  const dice3d = game?.dice3d;
  if (!dice3d || typeof dice3d._emitPersistentEvent !== "function") {
    diag("pdm hook: not yet ready, deferring to diceSoNiceReady");
    Hooks.once("diceSoNiceReady", installPdmThrowHook);
    return;
  }
  const orig = dice3d._emitPersistentEvent.bind(dice3d);
  dice3d._emitPersistentEvent = function (type, data) {
    try {
      if (type === "throw" && data?.data) onPdmThrow(data.data);
    } catch (e) {
      warn(TAG, "pdm throw hook failed", e);
    }
    return orig(type, data);
  };
  pdmHookInstalled = true;
  diag("pdm throw hook installed (_emitPersistentEvent wrapped)");
}

function onPdmThrow(throwData) {
  const persistentIds = throwData.persistentIds ?? [];
  const results = throwData.results ?? [];
  if (persistentIds.length === 0 || results.length === 0) return;

  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return;

  const myId = game.user?.id;
  // Find the dialog that owns these task dice and read its showBreakdown.
  const showBreakdown = inferTaskThrowBreakdown(persistentIds);

  const mirrors = [];
  for (const r of results) {
    const mesh = list.find((m) => m?.userData?.persistentId === r.persistentId);
    if (!mesh) continue;
    if (mesh.userData?.dsnPF2eBridge_owned !== true) continue;
    if (mesh.userData?.ownerUserId !== myId) continue;
    if (mesh.userData?.linkGroupSecondary === true) continue;

    const dieType = mesh.notation?.compositeType ?? mesh.notation?.type;
    const result = mesh.notation?.compositeResult ?? r.forcedResult;
    if (!dieType || result == null) continue;

    mirrors.push({ dieType, result, showBreakdown, viaTaskThrow: true });
  }
  if (mirrors.length === 0) return;
  emitMirror(mirrors, "pdm.throw");
}

function inferTaskThrowBreakdown(persistentIds) {
  // Find the dialog that owns these task dice by walking the live
  // persistentDiceList and reading each mesh's dsnPF2eBridge_dialogId tag.
  // We deliberately DON'T match against store._spawnedMeshIds because that
  // array is only populated at the END of the spawn loop — a user who
  // throws die #1 before die #5 finishes spawning would see _spawnedMeshIds
  // still empty and fall back to "true" (visible breakdown), which would
  // leak the value on a hidden-breakdown roll.
  const list = game.dice3d?.box?.persistentDiceList;
  if (!Array.isArray(list)) return true;
  const idSet = new Set(persistentIds);
  let dialogId = null;
  for (const mesh of list) {
    if (!idSet.has(mesh?.userData?.persistentId)) continue;
    if (mesh.userData?.dsnPF2eBridge_owned !== true) continue;
    dialogId = mesh.userData.dsnPF2eBridge_dialogId ?? null;
    if (dialogId != null) break;
  }
  if (dialogId == null) return true; // standalone throw — no dialog
  const store = SlotRegistry.get(dialogId);
  if (!store) return true;
  return inferShowBreakdownFromDialog(store.dialog);
}

function onCreateChatMessage(message) {
  try {
    if (message?.author?.id !== game.user?.id) return;
    const rolls = message?.rolls ?? [];
    if (rolls.length === 0) return;

    // Dedup #1: DSN posts its own "you rolled X" chat messages for any
    // persistent throw (when not suppressed). Those throws fire pdm
    // .onPersistentEvent — our pdm hook already mirrored them. Skip the
    // chat-message path so we don't emit twice for one physical throw.
    if (message?.flags?.["dice-so-nice"]?.persistent === true) {
      diag(`emit: skipping DSN persistent-throw chat ${message.id}`);
      return;
    }

    // Dedup #2: any roll our evaluate-wrapper consumed predetermined
    // values for is tagged `_dsnPersistentSourced`. The pdm hook already
    // mirrored those throws.
    const fromPersistent = rolls.some((r) => r?.options?._dsnPersistentSourced === true);
    if (fromPersistent) {
      diag(`emit: skipping ${message.id} — already mirrored via pdm.throw`);
      return;
    }

    const mirrors = [];
    for (const roll of rolls) {
      if (!roll?.dice) continue;
      const showBreakdown = roll?.options?.showBreakdown !== false;
      for (const die of roll.dice) {
        if (!Number.isFinite(die.faces)) continue;
        for (const result of die.results ?? []) {
          if (!result?.active) continue;
          mirrors.push({ dieType: `d${die.faces}`, result: result.result, showBreakdown });
        }
      }
    }
    if (mirrors.length === 0) return;
    emitMirror(mirrors, `chat:${message.id}`);
  } catch (e) {
    warn(TAG, "createChatMessage hook failed", e);
  }
}

function emitMirror(mirrors, source) {
  try {
    game.socket?.emit(SOCKET_NAME, {
      type: "task-mirror-throw",
      ownerUserId: game.user?.id,
      mirrors,
    });
    diag(`emit (${source}): broadcast ${mirrors.length} mirror(s)`, mirrors);
  } catch (e) {
    warn(TAG, "socket emit failed", e);
  }
}

export function applyMirrorThrow(payload) {
  diag("receive: socket message arrived", payload);
  if (payload?.ownerUserId === game.user?.id) {
    diag("receive: skipped (own emit echoed back)");
    return;
  }

  const dice3d = game.dice3d;
  if (!dice3d) {
    warn(TAG, "receive arrived but game.dice3d not ready");
    return;
  }

  const visibility = game?.dice3d?.box?.persistentDiceVisibility;
  const isHiddenViewer = visibility === "mine" || visibility === "none";
  const isGM = !!game.user?.isGM;

  const mirrors = payload.mirrors ?? [];
  for (const m of mirrors) {
    // Two reasons to spawn the ephemeral on this receiver:
    //   - hidden viewer (DSN's filter would skip the persistent throw)
    //   - task throw with hidden breakdown (opener spawned local-only,
    //     no DSN broadcast reached us, mirror is the only visual path
    //     and gives non-GMs a ghost throw without leaking the value)
    const taskThrowHiddenBd = m.viaTaskThrow && m.showBreakdown === false;
    if (!isHiddenViewer && !taskThrowHiddenBd) {
      diag(`receive: skipped die ${m.dieType}=${m.result} (visibility=${visibility}, viaTask=${!!m.viaTaskThrow}, breakdown=${m.showBreakdown})`);
      continue;
    }
    const ghost = m.showBreakdown === false && !isGM;
    diag(`receive: spawning ${m.dieType}=${m.result}${ghost ? " (ghost)" : ""} on ${visibility} viewer`);
    spawnEphemeralMirror(m.dieType, m.result, ghost).catch((e) =>
      warn(TAG, "spawn failed", e)
    );
  }
}

async function spawnEphemeralMirror(dieType, result, ghost) {
  const facesMatch = /^d(\d+)$/i.exec(String(dieType).trim());
  if (!facesMatch) {
    diag("spawn: bad dieType", dieType);
    return;
  }
  const faces = parseInt(facesMatch[1], 10);

  let roll;
  try {
    roll = await new Roll(`1d${faces}`).evaluate();
  } catch (e) {
    warn(TAG, "roll evaluate failed", e);
    return;
  }
  try {
    const term = roll.dice?.[0] ?? roll.terms?.[0];
    if (term?.results?.[0]) term.results[0].result = result;
    if ("_total" in roll) roll._total = result;
    if (ghost) {
      roll.ghost = true;
      roll.options ??= {};
      roll.options.appearance = { ...(roll.options.appearance ?? {}), isGhost: true };
      if (term) {
        term.options ??= {};
        term.options.appearance = { ...(term.options.appearance ?? {}), isGhost: true };
      }
    }
  } catch (e) {
    diag("spawn: result override threw", e);
  }

  try {
    const ok = await game.dice3d.showForRoll(
      roll, game.user, false, null, false, null, null,
      ghost ? { ghost: true } : undefined
    );
    diag(`spawn: showForRoll d${faces} → ${result}${ghost ? " (ghost)" : ""} returned ${ok}`);
  } catch (e) {
    warn(TAG, "showForRoll failed", e);
  }
}
