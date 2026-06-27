/**
 * Client-side courier volumetric-weight costing (mirrors the backend
 * utils/courierCosting.js). Chargeable weight = max(actual gross weight,
 * volumetric weight), where volumetric kg = (L × W × H in cm) / divisor.
 */

export const COURIER_COSTING_DEFAULTS = {
  divisor: 5000,
  baseWeightKg: 1,
  baseFare: 60,
  perKgFare: 20,
  roundStepKg: 0.5,
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function roundUpTo(value, step) {
  if (!(step > 0)) return value;
  return Math.ceil(round2(value) / step) * step;
}

/**
 * @param {Array<{ qty, weightKg, grossWeightGrams, netWeightGrams, lengthCm, widthCm, heightCm }>} items
 * @param {object} [config]
 */
export function estimateCourierCost(items = [], config = {}) {
  const cfg = { ...COURIER_COSTING_DEFAULTS, ...config };
  let totalActualKg = 0;
  let totalVolumetricKg = 0;
  let anyDims = false;
  let anyWeight = false;

  for (const item of items) {
    const qty = Math.max(0, Number(item.qty || 0));
    const grossG = Number(item.grossWeightGrams || item.netWeightGrams || 0);
    const actualKg = (grossG / 1000) * qty;
    const L = Number(item.lengthCm || 0);
    const W = Number(item.widthCm || 0);
    const H = Number(item.heightCm || 0);
    const hasDims = L > 0 && W > 0 && H > 0;
    if (hasDims) anyDims = true;
    if (actualKg > 0) anyWeight = true;
    const volumetricKg = hasDims ? ((L * W * H) / cfg.divisor) * qty : 0;
    totalActualKg = round2(totalActualKg + actualKg);
    totalVolumetricKg = round2(totalVolumetricKg + volumetricKg);
  }

  const chargeableKg = round2(Math.max(totalActualKg, totalVolumetricKg));
  const billedKg = round2(roundUpTo(chargeableKg, cfg.roundStepKg));
  const extraKg = Math.max(0, billedKg - cfg.baseWeightKg);
  const estimatedCost = round2(cfg.baseFare + Math.ceil(round2(extraKg)) * cfg.perKgFare);

  return {
    config: cfg,
    totalActualKg,
    totalVolumetricKg,
    chargeableKg,
    billedKg,
    volumetric: totalVolumetricKg > totalActualKg,
    estimatedCost,
    hasData: anyDims || anyWeight,
  };
}
