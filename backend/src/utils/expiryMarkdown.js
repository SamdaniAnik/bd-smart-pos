/**
 * Near-expiry auto-markdown tiers.
 *
 * Config shape (stored on Branch.expiryMarkdownJson):
 *   { enabled: boolean, tiers: [{ days: number, percent: number }] }
 *
 * A tier "{ days: 7, percent: 40 }" means: when a batch is within 7 days of
 * expiry, mark it down 40%. When several tiers match (the item is within
 * multiple day-windows), the largest discount wins.
 */

const DEFAULT_TIERS = [
  { days: 30, percent: 10 },
  { days: 14, percent: 25 },
  { days: 7, percent: 40 },
  { days: 3, percent: 60 },
];

const DEFAULT_CONFIG = { enabled: false, tiers: DEFAULT_TIERS };

function sanitizeTiers(tiers) {
  if (!Array.isArray(tiers)) return [];
  const cleaned = tiers
    .map((t) => ({
      days: Math.max(0, Math.floor(Number(t?.days))),
      percent: Math.max(0, Math.min(95, Number(t?.percent))),
    }))
    .filter((t) => Number.isFinite(t.days) && t.days > 0 && t.percent > 0);
  // Sort ascending by days so the tightest (nearest-expiry) window is evaluated first.
  cleaned.sort((a, b) => a.days - b.days);
  return cleaned;
}

function parseConfig(json) {
  if (!json) return { ...DEFAULT_CONFIG, tiers: sanitizeTiers(DEFAULT_TIERS) };
  let raw = json;
  if (typeof json === "string") {
    try {
      raw = JSON.parse(json);
    } catch {
      return { ...DEFAULT_CONFIG, tiers: sanitizeTiers(DEFAULT_TIERS) };
    }
  }
  const tiers = sanitizeTiers(raw?.tiers);
  return {
    enabled: Boolean(raw?.enabled),
    tiers: tiers.length ? tiers : sanitizeTiers(DEFAULT_TIERS),
  };
}

function serializeConfig(config) {
  return JSON.stringify({
    enabled: Boolean(config?.enabled),
    tiers: sanitizeTiers(config?.tiers),
  });
}

function daysUntil(expiryDate, now = new Date()) {
  if (!expiryDate) return null;
  const exp = new Date(expiryDate);
  if (Number.isNaN(exp.getTime())) return null;
  const ms = exp.getTime() - now.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/** Largest applicable markdown percent for a given days-to-expiry. */
function markdownPercentForDays(daysToExpiry, tiers) {
  if (daysToExpiry == null) return 0;
  let best = 0;
  for (const tier of tiers || []) {
    if (daysToExpiry <= tier.days) best = Math.max(best, tier.percent);
  }
  return best;
}

function maxTierDays(tiers) {
  return (tiers || []).reduce((m, t) => Math.max(m, t.days), 0);
}

function applyMarkdown(price, percent) {
  const p = Math.max(0, Number(price) || 0);
  const pct = Math.max(0, Math.min(95, Number(percent) || 0));
  return Math.round(p * (1 - pct / 100) * 100) / 100;
}

module.exports = {
  DEFAULT_TIERS,
  DEFAULT_CONFIG,
  parseConfig,
  serializeConfig,
  sanitizeTiers,
  daysUntil,
  markdownPercentForDays,
  maxTierDays,
  applyMarkdown,
};
