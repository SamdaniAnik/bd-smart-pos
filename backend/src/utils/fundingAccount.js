const MFS_FUNDING_METHODS = new Set(["bkash", "nagad", "rocket", "upay", "mfs"]);

/**
 * Maps payment method + optional explicit GL code to the credit (outflow) or debit (inflow) cash/bank account code.
 * Defaults: Cash → 1100, Bank-like methods → 1130, MFS wallets (bKash/Nagad/Rocket/Upay) → 1150.
 */
function resolveFundingAccountCode(method, explicitCode) {
  if (explicitCode != null && String(explicitCode).trim()) {
    return String(explicitCode).trim();
  }
  const m = String(method || "Cash").toLowerCase();
  if (MFS_FUNDING_METHODS.has(m)) {
    return "1150";
  }
  if (m === "bank" || m === "transfer" || m === "rtgs" || m === "eft" || m === "wire") {
    return "1130";
  }
  return "1100";
}

function isMfsFundingMethod(method) {
  return MFS_FUNDING_METHODS.has(String(method || "").toLowerCase());
}

module.exports = { resolveFundingAccountCode, isMfsFundingMethod };
