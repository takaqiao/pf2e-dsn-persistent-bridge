/**
 * Decide whether a roll dialog's outcome should be visible (broadcast as a
 * "public" task die) or hidden (local-only spawn + ghost-throw replay for
 * non-GM viewers).
 *
 * **Single authoritative signal: `actor.alliance === "party"`.**
 *
 * PF2e ships an explicit alliance system (`actor.system.details.alliance`,
 * one of "party" / "opposition" / null). It's the cleanest "ally vs enemy
 * vs neutral" signal in the data model and exactly maps to the user's
 * intent: ally rolls broadcast, enemy / neutral rolls don't. The earlier
 * cascading heuristic (type === "character" || parties.size > 0 ||
 * hasPlayerOwner) was too liberal — NPCs added to a party for tracking
 * purposes were leaking through the parties.size check even when their
 * alliance was clearly "opposition".
 *
 * Community precedent: pf2e-toolbelt and xdy-pf2e-workbench both use
 * `alliance === "party"` for their respective ally / party checks.
 * PF2e's own internal default-resolution pattern is
 *   `ALLIANCES.has(stored) ? stored : (hasPlayerOwner ? "party" : "opposition")`
 * (see CharacterPF2e prepare-base-data and damage-system source).
 *
 * Bridge logic (this file) priority-ordered:
 *
 *   1. Stored alliance is one of "party" / "opposition" / null → use it.
 *      "party" = visible, "opposition" / null = hidden. This is the GM's
 *      explicit classification and we always honor it.
 *
 *   2. Stored alliance is undefined (sparse old saves, custom actor types
 *      without the field initialized) → fall back to type+ownership:
 *        - `actor.type === "character"` → visible (covers GM-only PCs,
 *          pre-gens, PCs whose player isn't online — these still feel
 *          like PCs to the GM regardless of player assignment)
 *        - else → `hasPlayerOwner` (PF2e's stock fallback)
 *
 * Note: this controls only the BRIDGE's broadcast / ghost-mirror decision.
 * PF2e's own chat tooltip "show breakdown" still uses its own logic
 * (`metagame.breakdowns || hasPlayerOwner`) — we don't override that.
 */

function metagameAllowsBreakdown() {
  try {
    return !!game.settings.get("pf2e", "metagame_showBreakdowns");
  } catch {
    return false;
  }
}

function actorIsBreakdownVisible(actor) {
  if (!actor) return null; // signal: caller falls back to safe default
  const stored = actor.alliance;
  if (stored === "party") return true;
  if (stored === "opposition") return false;
  if (stored === null) return false; // explicit neutral
  // Stored is undefined — actor lacks an explicit alliance setting.
  // Promote character actors regardless of ownership (covers GM-only PCs).
  if (actor.type === "character") return true;
  // Other actor types: PF2e's stock fallback.
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
