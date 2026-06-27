// Rocket (Dutch-Bangla Mobile Banking) merchant payment adapter.
// Configure with ROCKET_BASE_URL, ROCKET_API_KEY, optional ROCKET_API_SECRET
// (HMAC), ROCKET_MERCHANT_ID/ROCKET_MERCHANT_NUMBER, and optional *_PATH overrides.
const { makeAdapter } = require("./walletClient");

module.exports = makeAdapter("ROCKET", "Rocket");
