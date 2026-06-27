const { bookPathaoShipment, trackPathaoShipment } = require("./pathao");
const { bookSteadfastShipment, trackSteadfastShipment } = require("./steadfast");
const { bookRedxShipment } = require("./redx");
const { bookPaperflyShipment } = require("./paperfly");

const LIVE_PROVIDERS = new Set(["pathao", "steadfast", "redx", "paperfly"]);

function isLiveCourierProvider(provider) {
  return LIVE_PROVIDERS.has(String(provider || "").toLowerCase());
}

function hasLiveCourierCredentials(provider, branch) {
  const p = String(provider || "").toLowerCase();
  if (p === "pathao") {
    return Boolean(
      (branch?.courierApiKey || process.env.PATHAO_CLIENT_ID) &&
        process.env.PATHAO_CLIENT_SECRET &&
        process.env.PATHAO_USERNAME &&
        process.env.PATHAO_PASSWORD
    );
  }
  if (p === "steadfast") {
    return Boolean((branch?.courierApiKey || process.env.STEADFAST_API_KEY) && process.env.STEADFAST_SECRET_KEY);
  }
  if (p === "redx") {
    return Boolean(branch?.courierApiKey || process.env.REDX_API_TOKEN);
  }
  if (p === "paperfly") {
    return Boolean(branch?.courierApiKey || process.env.PAPERFLY_API_KEY);
  }
  return false;
}

async function bookCourierShipment({ provider, branch, recipientName, recipientPhone, address, codAmount, referenceId, district, area }) {
  const p = String(provider || "").toLowerCase();
  const input = { branch, recipientName, recipientPhone, address, codAmount, referenceId, district, area };

  if (p === "pathao") return bookPathaoShipment(input);
  if (p === "steadfast") return bookSteadfastShipment(input);
  if (p === "redx") return bookRedxShipment(input);
  if (p === "paperfly") return bookPaperflyShipment(input);
  throw new Error(`Unsupported live courier provider: ${provider}`);
}

const TRACKABLE_PROVIDERS = new Set(["pathao", "steadfast"]);

function isTrackableProvider(provider) {
  return TRACKABLE_PROVIDERS.has(String(provider || "").toLowerCase());
}

async function trackCourierShipment({ provider, branch, trackingId, consignmentId }) {
  const p = String(provider || "").toLowerCase();
  if (p === "pathao") return trackPathaoShipment({ branch, trackingId });
  if (p === "steadfast") return trackSteadfastShipment({ branch, trackingId, consignmentId });
  throw new Error(`Status tracking not supported for provider: ${provider}`);
}

module.exports = {
  bookCourierShipment,
  trackCourierShipment,
  isLiveCourierProvider,
  isTrackableProvider,
  hasLiveCourierCredentials,
};
