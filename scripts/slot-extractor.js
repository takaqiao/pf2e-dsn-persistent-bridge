/**
 * Extract a flat list of slot descriptors {faces, key} from a PF2e dialog.
 * Each slot represents one Die that needs rolling.
 *
 * For CheckModifiersDialog: derive from check formula + rollTwice context
 * For DamageModifierDialog: regex parse the rendered submit-button formula text
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
  // Try the modern dialog.formulaData path first (most reliable),
  // falling back to a regex on the rendered submit-button formula.
  const fromFormulaData = slotsFromFormulaData(dialog?.formulaData);
  if (fromFormulaData?.length) return fromFormulaData;

  return slotsFromButtonText(dialog);
}

function slotsFromFormulaData(formulaData) {
  if (!formulaData) return null;
  const slots = [];
  let key = 0;

  // base damage entries: [{ diceNumber, dieSize, ...}]
  for (const entry of formulaData.base ?? []) {
    const n = Number(entry?.diceNumber) || 0;
    const f = parseFacesFromDieString(entry?.dieSize);
    if (!f || n < 1) continue;
    for (let i = 0; i < n; i++) slots.push({ faces: f, key: key++ });
  }

  // additional damage dice array entries (DamageDicePF2e instances)
  for (const d of formulaData.dice ?? []) {
    if (d?.enabled === false) continue;
    const n = Number(d?.diceNumber ?? d?.override?.diceNumber) || 0;
    const f = parseFacesFromDieString(d?.dieSize ?? d?.override?.dieSize);
    if (!f || n < 1) continue;
    for (let i = 0; i < n; i++) slots.push({ faces: f, key: key++ });
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
