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
  const userId = game.user?.id;
  if (!userId) {
    // Defensive: no user means no pending queue lookup is meaningful.
    // Foundry shouldn't fire roll evaluations pre-ready, but guard so
    // a transient disconnect race doesn't crash here.
    return wrapped(...args);
  }
  const pending = PendingQueue.peek(userId);
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
  PendingQueue.pop(userId);

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
    if (typeof term.roll !== "function") continue;

    // Patch ONLY `roll` — the actual evaluation entry point in Foundry
    // v13/v14. `DiceTerm#roll(options)` produces one result object, pushes
    // it into `this.results` itself, and returns it; the term is driven
    // exclusively through `roll()` during evaluation. (Confirmed in
    // production: injected faces land correctly, which is only possible if
    // `roll` is the entry point and self-pushes — so we mirror that.)
    //
    // We deliberately DO NOT patch `_roll`. The previous dual-patch assumed
    // `_roll(n)` took a count and returned an array of {result,active}; the
    // real signature is `_roll(options)` returning a single number. On the
    // RNG-fallback path the patched `roll` delegated to the original `roll`,
    // which calls `this._roll(options)` internally — hitting the wrong-arity
    // patched `_roll` (`for (i=0; i<options; i++)` → `0 < {}` → `[]`),
    // corrupting the result to 0/NaN AND then pushing a second time (double
    // push inflated results.length, breaking kh/kl/count and under-rolling
    // remaining dice). Patching only `roll` and letting the original `roll`
    // use the untouched `_roll` for fallback fixes both the corruption and
    // the double-push. Injection is unchanged from the prior working path.
    const hadOwn = Object.prototype.hasOwnProperty.call(term, "roll");
    const originalRoll = term.roll.bind(term);
    term.roll = function (options = {}) {
      if (queue.length > 0) {
        // Inject a predetermined face: build the result object and push it
        // ourselves exactly once, mirroring DiceTerm#roll's own contract.
        const o = { result: queue.shift(), active: true };
        this.results.push(o);
        return o;
      }
      // Queue exhausted (partial-fill submit, or a modifier-driven extra
      // roll such as reroll `r` / explode `x`/`xo`): defer to the genuine
      // original roll. It performs a real RNG roll AND pushes its own
      // result, so we return it directly and must NOT push again.
      return originalRoll(options);
    };
    restore.push(() => {
      if (hadOwn) term.roll = originalRoll;
      else delete term.roll;
    });
  }
  return restore;
}
