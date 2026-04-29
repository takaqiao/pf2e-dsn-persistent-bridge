/**
 * Resolve PF2e's `showBreakdown` for an open roll dialog.
 *
 * Critical: at `renderCheckModifiersDialog` / `renderDamageModifierDialog`
 * time, the *roll* doesn't exist yet — PF2e constructs the CheckRoll /
 * DamageRoll only after the user submits and the dialog resolve()s. So
 * `dialog.check.options.showBreakdown` and `dialog.damage.roll.options
 * .showBreakdown` are both undefined while the dialog is open. We have
 * to compute the equivalent from `dialog.context` ourselves, mirroring
 * the formulas PF2e uses when it eventually creates the roll.
 *
 * Reference (pf2e.mjs in this install):
 *   line 24033 — CheckRoll:
 *     showBreakdown = context.type === "flat-check"
 *                  || game.pf2e.settings.metagame.breakdowns
 *                  || !!context.actor?.hasPlayerOwner
 *
 *   line 23795 / 57627 — DamageRoll:
 *     showBreakdown = game.pf2e.settings.metagame.breakdowns
 *                  || !!context.self?.actor?.hasPlayerOwner
 *
 * Note the actor path differs: CheckModifiersDialog has `context.actor`
 * directly; DamageModifierDialog wraps it in `context.self.actor`.
 *
 * Returns true (visible) when nothing in the context tells us otherwise —
 * a safe default that doesn't accidentally hide things.
 */

function metagameAllowsBreakdown() {
  try {
    return !!game.settings.get("pf2e", "metagame_showBreakdowns");
  } catch {
    return false;
  }
}

export function inferShowBreakdownFromDialog(dialog) {
  if (!dialog) return true;
  const ctx = dialog?.context;
  if (!ctx) return true;

  // Flat checks always show their breakdown (PF2e treats them as transparent).
  if (ctx.type === "flat-check") return true;
  // World setting overrides actor-ownership check.
  if (metagameAllowsBreakdown()) return true;

  // CheckModifiersDialog stashes the actor at context.actor.
  // DamageModifierDialog wraps it in context.self.actor.
  // Probe both — use whichever is present. If both are absent, fall
  // through to the safe default (visible).
  const checkActor = ctx.actor;
  if (checkActor) return !!checkActor.hasPlayerOwner;

  const damageActor = ctx.self?.actor;
  if (damageActor) return !!damageActor.hasPlayerOwner;

  return true;
}
