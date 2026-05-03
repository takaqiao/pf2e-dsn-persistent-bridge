/**
 * Extract a flat list of slot descriptors {faces, key, flavor?} from a PF2e
 * dialog. Each slot represents one Die that needs rolling.
 *
 * For CheckModifiersDialog: derive from check formula + rollTwice context.
 *   No flavor — d20 checks have no damage type.
 * For DamageModifierDialog: regex parse the rendered submit-button formula
 *   text for accurate count, then attach per-die `flavor` (the PF2e damage
 *   type) by walking `formulaData.base` + `formulaData.dice` in order. The
 *   flavor is later passed to DSN's `getAppearanceForDice(raw, dieType,
 *   {options: {type}})` so the spawned task die respects the user's
 *   per-damage-type colorset / preset configuration (DSN 6.0+ feature).
 */

const D20_FACES = 20;

export function extractSlots(dialog) {
  const cls = dialog?.constructor?.name;
  if (cls === "CheckModifiersDialog") return extractCheckSlots(dialog);
  if (cls === "DamageModifierDialog") return extractDamageSlots(dialog);
  return [];
}

function extractCheckSlots(dialog) {
  const rollTwice = dialog.context?.rollTwice;
  // Substitution can replace the d20 with another faces; PF2e supports only d20 swaps as of v7.
  // We default to d20 and let the wrapper handle alt faces if PF2e ever changes.
  const subs = dialog.context?.substitutions ?? [];
  const activeSub = subs.find((s) => s.selected && !s.ignored);
  const subDie = activeSub?.diceSize ?? activeSub?.dieSize;
  const faces = parseFacesFromDieString(subDie) ?? D20_FACES;

  if (rollTwice === "keep-higher" || rollTwice === "keep-lower") {
    return [{ faces, key: 0 }, { faces, key: 1 }];
  }
  return [{ faces, key: 0 }];
}

function extractDamageSlots(dialog) {
  // PREFER the rendered submit-button formula. PF2e's DamageModifierDialog
  // builds the button text from `createDamageFormula(formulaData, degree)`
  // — meaning by the time the user sees it, the formula has already had
  // every transform applied:
  //
  //   • Rule Element `override.diceNumber` formulas (e.g. kineticist
  //     "max(1 + floor((@actor.level - 1) / 4), 1)") resolved to integers.
  //   • Critical-double dice — when `pf2e.critRule === "doubledice"` and
  //     this is a crit, the formula contains `2dN[doubled]` instead of `1dN`.
  //   • Crit-only bonus dice (deadly, fatal, scatter) included.
  //   • Splash / persistent / precision categories already merged.
  //
  // The structural `formulaData` path doesn't apply doubling and stores
  // RE formulas as raw strings — using it on a crit-doubledice or RE-driven
  // damage dialog produces the wrong slot count, leaving extra dice to fall
  // back to RNG (visible in chat but never rolled physically).
  //
  // Use `formulaData` only as a fallback for the rare case where the button
  // text isn't yet populated when our hook fires.
  const fromButton = slotsFromButtonText(dialog);
  if (fromButton.length === 0) {
    return slotsFromFormulaData(dialog?.formulaData) ?? [];
  }
  // Decorate slots with per-die damage type for DSN's per-flavor colorset.
  attachDamageFlavors(fromButton, dialog);
  return fromButton;
}

/**
 * Walk `formulaData` and queue up each base/bonus die's damage type, then
 * dequeue per-faces into the button-text-derived slots in order. PF2e's
 * formula text is built base-then-bonus per instance, which matches our
 * walk order, so per-faces FIFO assignment is correct in the common case.
 *
 * Modern PF2e (v8+) puts dice in nested `base[].terms[]` rather than directly
 * on each base entry. Each term has shape `{dice: {number, faces}, modifier?}`.
 * Legacy structure had `diceNumber`+`dieSize` directly on the base entry. We
 * support both, with the nested terms taking priority.
 *
 * Edge cases left to default (slot.flavor=null → DSN uses base appearance):
 *   • Bonus dice with formula-string `diceNumber` (RE) — Number(...) gives 0
 *     so we don't enqueue flavors for them. The button-text slots for those
 *     dice end up unflavored. Acceptable: users mostly want their base
 *     damage type styled, not RE-injected bonus dice.
 *   • Multi-instance damage with mixed types — if instance order doesn't
 *     match the formula text exactly, slots may get the wrong type. Still
 *     better than uniform default.
 */
function attachDamageFlavors(slots, dialog) {
  const formulaData = dialog?.formulaData;
  if (!formulaData) return;
  const factor = isCriticalDoubledDice(dialog) ? 2 : 1;
  const baseType = formulaData?.base?.[0]?.damageType ?? null;
  const queue = new Map(); // faces -> [damageType, ...]
  const enqueue = (faces, type, count) => {
    if (!faces || !Number.isFinite(count) || count < 1) return;
    if (!queue.has(faces)) queue.set(faces, []);
    const list = queue.get(faces);
    for (let i = 0; i < count; i++) list.push(type ?? null);
  };

  for (const entry of formulaData.base ?? []) {
    const damageType = entry?.damageType ?? baseType;
    // Modern path: dice live inside `entry.terms[]` as `{dice: {number, faces}}`.
    if (Array.isArray(entry?.terms) && entry.terms.length > 0) {
      for (const t of entry.terms) {
        const f = Number(t?.dice?.faces);
        const n = (Number(t?.dice?.number) || 0) * factor;
        if (Number.isFinite(f) && f > 0) enqueue(f, damageType, n);
      }
    } else {
      // Legacy path: diceNumber + dieSize directly on entry.
      const f = parseFacesFromDieString(entry?.dieSize);
      const n = (Number(entry?.diceNumber) || 0) * factor;
      enqueue(f, damageType, n);
    }
  }
  for (const d of formulaData.dice ?? []) {
    if (d?.enabled === false) continue;
    const f = parseFacesFromDieString(d?.dieSize ?? d?.override?.dieSize);
    const n = (Number(d?.diceNumber ?? d?.override?.diceNumber) || 0) * factor;
    // Bonus dice with damageType=null typically inherit the base instance's type.
    enqueue(f, d?.damageType ?? baseType, n);
  }

  for (const slot of slots) {
    const list = queue.get(slot.faces);
    if (list && list.length > 0) {
      const flavor = list.shift();
      if (flavor) slot.flavor = flavor;
    }
  }
}

function isCriticalDoubledDice(dialog) {
  if (!dialog?.isCritical) return false;
  try {
    return game.settings.get("pf2e", "critRule") === "doubledice";
  } catch {
    return false;
  }
}

function slotsFromFormulaData(formulaData) {
  if (!formulaData) return null;
  const slots = [];
  let key = 0;
  const baseType = formulaData?.base?.[0]?.damageType ?? null;
  const push = (faces, count, flavor) => {
    if (!faces || !Number.isFinite(count) || count < 1) return;
    for (let i = 0; i < count; i++) slots.push({ faces, key: key++, flavor: flavor ?? undefined });
  };

  // base damage entries — modern PF2e v8+: dice in `entry.terms[]`;
  // legacy: `diceNumber`/`dieSize` directly on entry.
  for (const entry of formulaData.base ?? []) {
    const damageType = entry?.damageType ?? baseType;
    if (Array.isArray(entry?.terms) && entry.terms.length > 0) {
      for (const t of entry.terms) {
        const f = Number(t?.dice?.faces);
        const n = Number(t?.dice?.number) || 0;
        if (Number.isFinite(f) && f > 0) push(f, n, damageType);
      }
    } else {
      const f = parseFacesFromDieString(entry?.dieSize);
      const n = Number(entry?.diceNumber) || 0;
      push(f, n, damageType);
    }
  }

  // additional damage dice array entries (DamageDicePF2e instances).
  // diceNumber may be a formula string (RE override) — Number() yields 0,
  // those dice get skipped here. The button-text path is the primary one
  // for resolving such formulas; this fallback is best-effort.
  for (const d of formulaData.dice ?? []) {
    if (d?.enabled === false) continue;
    const n = Number(d?.diceNumber ?? d?.override?.diceNumber) || 0;
    const f = parseFacesFromDieString(d?.dieSize ?? d?.override?.dieSize);
    push(f, n, d?.damageType ?? baseType);
  }

  return slots;
}

function slotsFromButtonText(dialog) {
  try {
    const el = dialog?.element?.[0] ?? dialog?.element;
    const btn = el?.querySelector?.("form.check-modifiers-content > button[type=submit]");
    const text = btn?.textContent ?? "";
    const slots = [];
    let key = 0;
    for (const m of text.matchAll(/(\d+)\s*d\s*(\d+)/gi)) {
      const n = parseInt(m[1], 10);
      const f = parseInt(m[2], 10);
      if (!Number.isFinite(n) || !Number.isFinite(f)) continue;
      for (let i = 0; i < n; i++) slots.push({ faces: f, key: key++ });
    }
    return slots;
  } catch {
    return [];
  }
}

function parseFacesFromDieString(s) {
  if (typeof s !== "string") return null;
  const m = /^d(\d+)$/i.exec(s.trim());
  return m ? parseInt(m[1], 10) : null;
}
