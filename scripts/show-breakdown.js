/**
 * Resolve PF2e's `showBreakdown` for an open roll dialog.
 *
 * Critical: at `renderCheckModifiersDialog` / `renderDamageModifierDialog`
 * time, the *roll* doesn't exist yet — PF2e constructs the CheckRoll /
 * DamageRoll only after the user submits and the dialog resolve()s. So
 * `dialog.check.options.showBreakdown` and `dialog.damage.roll.options
 * .showBreakdown` are both undefined while the dialog is open. We have
 * to compute the equivalent from `dialog.context` ourselves.
 *
 * Reference (pf2e.mjs in this install):
 *   CheckRoll:
 *     showBreakdown = context.type === "flat-check"
 *                  || game.pf2e.settings.metagame.breakdowns
 *                  || !!context.actor?.hasPlayerOwner
 *
 *   DamageRoll:
 *     showBreakdown = game.pf2e.settings.metagame.breakdowns
 *                  || !!context.self?.actor?.hasPlayerOwner
 *
 * Note the actor path differs: CheckModifiersDialog has `context.actor`;
 * DamageModifierDialog wraps it in `context.self.actor`.
 *
 * **Bridge deviation from PF2e**: we additionally treat `actor.type ===
 * "character"` (PC) as breakdown-visible regardless of `hasPlayerOwner`.
 * Why: a GM running a pre-gen, NPC ally, or PC whose player is offline /
 * unassigned has `hasPlayerOwner === false`, which would normally make us
 * spawn task dice local-only and ghost-mirror the throw to other players —
 * even though the GM clearly considers it a "PC" roll and expects players
 * to see real dice. The actor TYPE is the more reliable PC/NPC signal,
 * `hasPlayerOwner` is just a permissions check that doesn't always match
 * intent. We still respect `hasPlayerOwner` for non-character actor types
 * (npc / hazard / vehicle) to keep the value-leak protection for genuinely
 * GM-controlled entities.
 *
 * Returns true (visible) when nothing in the context tells us otherwise.
 */

function metagameAllowsBreakdown() {
  try {
    return !!game.settings.get("pf2e", "metagame_showBreakdowns");
  } catch {
    return false;
  }
}

function actorIsBreakdownVisible(actor) {
  if (!actor) return null; // signal: caller should fall back
  if (actor.type === "character") return true;
  return !!actor.hasPlayerOwner;
}

export function inferShowBreakdownFromDialog(dialog) {
  if (!dialog) return true;
  const ctx = dialog?.context;
  if (!ctx) return true;

  // Flat checks always show their breakdown (PF2e treats them as transparent).
  if (ctx.type === "flat-check") return true;
  // World setting overrides actor-ownership check.
  if (metagameAllowsBreakdown()) return true;

  // Determine where the rolling actor lives based on dialog class.
  // - CheckModifiersDialog: `context.actor`
  // - DamageModifierDialog: `context.self.actor` (`context.actor` may be
  //   the target — using it for breakdown decisions caused early v0.2
  //   regressions where target-NPC presence flipped a PC's damage roll
  //   to ghost-on-receivers).
  const cls = dialog?.constructor?.name;
  if (cls === "DamageModifierDialog") {
    const result = actorIsBreakdownVisible(ctx.self?.actor);
    if (result !== null) return result;
    return true;
  }
  // CheckModifiersDialog (and any unrecognized dialog class)
  const result = actorIsBreakdownVisible(ctx.actor);
  if (result !== null) return result;
  // Last-resort fallback: try damage-style path even on unknown dialog
  // classes, since some PF2e flows reuse DamageContext shape.
  const fallback = actorIsBreakdownVisible(ctx.self?.actor);
  if (fallback !== null) return fallback;
  return true;
}
