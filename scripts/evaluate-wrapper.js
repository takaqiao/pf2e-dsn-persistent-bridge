import { MOD_ID, log, warn, err } from "./constants.js";
import { compat } from "./compat.js";
import { PendingQueue } from "./slot-store.js";

/**
 * libWrapper-based hijack of CheckRoll/DamageRoll evaluate().
 *
 * Strategy: per-term `_roll` replacement.
 *  - Before calling wrapped(), patch each Die instance on this Roll to
 *    pop predetermined values from a per-faces queue.
 *  - The original `_roll` is preserved and used as RNG fallback for
 *    leftover (unfilled) slots, so `requireAllSlots=false` works for free.
 *  - Modifier processing (`kh`/`kl`/`r1`/`xo`/`min`/`max`) runs AFTER `_roll`
 *    populates `results`, so all PF2e dice mechanics keep working.
 *  - In `finally`, restore originals so other Rolls are not affected.
 */

let installed = false;

export function installEvaluateWrapper() {
  if (installed) return;
  if (!compat.checkLibWrapper()) return;

  const CheckRoll = compat.getCheckRollClass();
  const DamageRoll = compat.getDamageRollClass();

  if (!CheckRoll && !DamageRoll) {
    warn("CheckRoll/DamageRoll not found in CONFIG.Dice.rolls — wrapper not installed (PF2e too new/old?)");
    return;
  }

  // libWrapper requires a string path. Park the classes on globalThis so we
  // can name them; this is a known workaround for non-globally-named classes.
  const stash = (globalThis.__pf2eDsnBridge ??= {});
  if (CheckRoll) stash.CheckRoll = CheckRoll;
  if (DamageRoll) stash.DamageRoll = DamageRoll;

  let count = 0;
  if (CheckRoll) {
    try {
      libWrapper.register(
        MOD_ID,
        "globalThis.__pf2eDsnBridge.CheckRoll.prototype.evaluate",
        evalWrapper,
        "WRAPPER"
      );
      count++;
    } catch (e) {
      err("failed to wrap CheckRoll.evaluate", e);
    }
  }
  if (DamageRoll) {
    try {
      libWrapper.register(
        MOD_ID,
        "globalThis.__pf2eDsnBridge.DamageRoll.prototype.evaluate",
        evalWrapper,
        "WRAPPER"
      );
      count++;
    } catch (e) {
      err("failed to wrap DamageRoll.evaluate", e);
    }
  }
  installed = count > 0;
  log(`evaluate wrapper installed on ${count} Roll class(es)`);
}

async function evalWrapper(wrapped, ...args) {
  const pending = PendingQueue.peek(game.user.id);
  if (!pending) {
    log("eval: no pending DSN values, passthrough", { rollClass: this.constructor?.name, formula: this.formula });
    return wrapped(...args);
  }

  // Build per-faces queue. We consume even if the predetermined array is all
  // null (i.e. user clicked "RNG All"), to avoid leaking the entry to a
  // subsequent unrelated roll.
  const byFaces = new Map();
  for (const p of pending.predetermined) {
    if (!p) continue;
    if (!byFaces.has(p.faces)) byFaces.set(p.faces, []);
    byFaces.get(p.faces).push(p.value);
  }
  PendingQueue.pop(game.user.id);

  if (byFaces.size === 0) return wrapped(...args);

  // Mark this Roll so the suppressRedundantDsn hook can stop DSN from
  // re-showing it as a freshly-thrown set of dice (the user already saw
  // the physical persistent dice land on the canvas with this exact value).
  try {
    this.options ??= {};
    this.options._dsnPersistentSourced = true;
  } catch (e) {
    // Critical: this flag tells suppressDsnThrowMessage to not re-show
    // the DSN throw animation for this roll (the user already saw the
    // physical persistent dice land). If we can't set it, the chat
    // message will trigger a redundant DSN animation. Surface the error
    // instead of swallowing — we need to see it in bug reports.
    err("failed to mark roll as persistent-sourced (DSN may re-animate)", e);
  }

  const dice = collectDice(this);
  log("eval: injecting", {
    rollClass: this.constructor?.name,
    formula: this.formula,
    queue: Object.fromEntries([...byFaces.entries()]),
    diceCount: dice.length,
    diceFacesList: dice.map(d => d.faces),
  });
  if (dice.length === 0) return wrapped(...args);

  const restore = patchDice(dice, byFaces);
  try {
    const out = await wrapped(...args);
    log("eval: post-wrap result", {
      total: out?.total,
      diceTotals: dice.map(d => ({ faces: d.faces, results: d.results?.map(r => r.result), total: d.total })),
    });
    return out;
  } finally {
    for (const fn of restore) {
      try { fn(); } catch (e) { err("restore _roll failed", e); }
    }
  }
}

/**
 * Collect all Die instances reachable from a Roll.
 * Roll.dice is a getter that flattens DiceTerm/Die instances inside terms,
 * including those nested inside PoolTerm (used by DamageRoll).
 */
function collectDice(roll) {
  const Die = getDieClass();
  const out = [];
  try {
    const flat = roll.dice ?? [];
    for (const t of flat) {
      if (Die && t instanceof Die) out.push(t);
      else if (!Die && t && typeof t._roll === "function" && Number.isFinite(t.faces)) out.push(t);
    }
  } catch (e) {
    err("collectDice failure", e);
  }
  return out;
}

function getDieClass() {
  return foundry?.dice?.terms?.Die ?? globalThis.Die ?? null;
}

function patchDice(dice, byFaces) {
  const restore = [];
  for (const term of dice) {
    const queue = byFaces.get(term.faces);
    if (!queue || queue.length === 0) continue;

    // Foundry v13/v14 has TWO entry points worth covering:
    //   - `_roll(n)` returning an array of {result, active}
    //   - older `roll({minimize,maximize})` returning a single {result, active}
    //     (and pushing into this.results internally)
    // We patch BOTH so we don't depend on which one the runtime calls.
    const restoreRoll = patchMethod(term, "_roll", function (n) {
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(takeFromQueueOrFallback(queue, this, "_roll"));
      }
      return out;
    });
    const restoreSingle = patchMethod(term, "roll", function (opts = {}) {
      const obj = takeFromQueueOrFallback(queue, this, "roll", opts);
      this.results.push(obj);
      return obj;
    });
    if (restoreRoll) restore.push(restoreRoll);
    if (restoreSingle) restore.push(restoreSingle);
  }
  return restore;
}

function patchMethod(term, methodName, replacement) {
  if (typeof term[methodName] !== "function") return null;
  const had = Object.prototype.hasOwnProperty.call(term, methodName);
  const original = term[methodName].bind(term);
  // Stash the bound original on the replacement so it can fall back to RNG.
  replacement.__dsnOriginal = original;
  term[methodName] = replacement;
  return () => {
    if (had) term[methodName] = original;
    else delete term[methodName];
  };
}

function takeFromQueueOrFallback(queue, term, kind, opts) {
  if (queue.length > 0) {
    return { result: queue.shift(), active: true };
  }
  // fall back to genuine RNG via the saved original
  const orig = term[kind]?.__dsnOriginal;
  if (typeof orig === "function") {
    const r = kind === "_roll" ? orig(1) : orig(opts);
    if (Array.isArray(r)) return r[0] ?? { result: 1, active: true };
    return r ?? { result: 1, active: true };
  }
  // last-ditch: plain randomFace if the term exposes it
  if (typeof term.randomFace === "function") {
    return { result: term.randomFace(), active: true };
  }
  return { result: 1, active: true };
}
