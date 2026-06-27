export function parseLoyaltyAisleBonusJson(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      const cat = String(key || "")
        .trim()
        .toUpperCase();
      if (!cat) continue;
      const mult = Number(value);
      if (Number.isFinite(mult) && mult > 0) out[cat] = mult;
    }
    return out;
  } catch {
    return {};
  }
}

export function stringifyLoyaltyAisleBonus(map) {
  const clean = parseLoyaltyAisleBonusJson(map);
  return Object.keys(clean).length ? JSON.stringify(clean) : "";
}
