/**
 * Courier volumetric-weight costing.
 *
 * Bangladeshi couriers (Pathao, Steadfast, RedX, ...) bill the *chargeable*
 * weight — the greater of the actual (gross) weight and the volumetric weight
 * derived from parcel dimensions. Volumetric kg = (L × W × H in cm) / divisor.
 * The common air divisor is 5000; some couriers use 6000.
 */

const DEFAULTS = {
  divisor: 5000,
  baseWeightKg: 1, // fare includes up to this weight
  baseFare: 60, // BDT for the base weight
  perKgFare: 20, // BDT per additional kg (rounded up)
  roundStepKg: 0.5, // chargeable weight rounded up to this step
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function roundUpTo(value, step) {
  if (!(step > 0)) return value;
  return Math.ceil(round2(value) / step) * step;
}

function lineWeights(product, qty) {
  const units = Math.max(0, Number(qty) || 0);
  const grossG = Number(product?.grossWeightGrams || product?.netWeightGrams || 0);
  const actualKg = (grossG / 1000) * units;
  const L = Number(product?.lengthCm || 0);
  const W = Number(product?.widthCm || 0);
  const H = Number(product?.heightCm || 0);
  const hasDims = L > 0 && W > 0 && H > 0;
  return { actualKg, L, W, H, hasDims, units };
}

/**
 * @param {object} opts
 * @param {Array<{ product: object, qty: number }>} opts.items
 * @param {object} [opts.config] divisor/baseWeightKg/baseFare/perKgFare/roundStepKg overrides
 */
function estimateCourierCost({ items = [], config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...sanitizeConfig(config) };
  const lines = [];
  let totalActualKg = 0;
  let totalVolumetricKg = 0;

  for (const entry of items) {
    const { product, qty } = entry || {};
    if (!product) continue;
    const { actualKg, L, W, H, hasDims, units } = lineWeights(product, qty);
    const volumetricKgPerUnit = hasDims ? (L * W * H) / cfg.divisor : 0;
    const volumetricKg = volumetricKgPerUnit * units;
    totalActualKg = round2(totalActualKg + actualKg);
    totalVolumetricKg = round2(totalVolumetricKg + volumetricKg);
    lines.push({
      productId: product.id || null,
      name: product.name || null,
      qty: units,
      actualKg: round2(actualKg),
      volumetricKg: round2(volumetricKg),
      hasDimensions: hasDims,
      hasWeight: actualKg > 0,
    });
  }

  const chargeableKg = round2(Math.max(totalActualKg, totalVolumetricKg));
  const billedKg = round2(roundUpTo(chargeableKg, cfg.roundStepKg));
  const extraKg = Math.max(0, billedKg - cfg.baseWeightKg);
  const estimatedCost = round2(cfg.baseFare + Math.ceil(round2(extraKg)) * cfg.perKgFare);

  return {
    config: cfg,
    lines,
    totalActualKg,
    totalVolumetricKg,
    chargeableKg,
    billedKg,
    volumetric: totalVolumetricKg > totalActualKg,
    estimatedCost,
    incompleteData: lines.some((l) => !l.hasDimensions && !l.hasWeight),
  };
}

function sanitizeConfig(config) {
  const out = {};
  if (config.divisor != null && Number(config.divisor) > 0) out.divisor = Number(config.divisor);
  if (config.baseWeightKg != null && Number(config.baseWeightKg) >= 0) out.baseWeightKg = Number(config.baseWeightKg);
  if (config.baseFare != null && Number(config.baseFare) >= 0) out.baseFare = Number(config.baseFare);
  if (config.perKgFare != null && Number(config.perKgFare) >= 0) out.perKgFare = Number(config.perKgFare);
  if (config.roundStepKg != null && Number(config.roundStepKg) > 0) out.roundStepKg = Number(config.roundStepKg);
  return out;
}

module.exports = { estimateCourierCost, DEFAULTS };
