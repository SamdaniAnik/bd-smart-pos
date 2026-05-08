/**
 * Maps payment method + optional explicit GL code to the credit (outflow) or debit (inflow) cash/bank account code.
 * Defaults: Cash → 1100, Bank-like methods → 1130.
 */
function resolveFundingAccountCode(method, explicitCode) {
  if (explicitCode != null && String(explicitCode).trim()) {
    return String(explicitCode).trim();
  }
  const m = String(method || "Cash").toLowerCase();
  if (m === "bank" || m === "transfer" || m === "rtgs" || m === "eft" || m === "wire") {
    return "1130";
  }
  return "1100";
}

module.exports = { resolveFundingAccountCode };
