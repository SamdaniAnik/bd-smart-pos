// Upay (UCB Fintech) merchant payment adapter.
// Configure with UPAY_BASE_URL, UPAY_API_KEY, optional UPAY_API_SECRET (HMAC),
// UPAY_MERCHANT_ID/UPAY_MERCHANT_NUMBER, and optional *_PATH overrides.
const { makeAdapter } = require("./walletClient");

module.exports = makeAdapter("UPAY", "Upay");
