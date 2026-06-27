const { PLANS, upgradePlan } = require("../../utils/subscriptionUtil");
const { initiatePayment, verifyPayment, getPaymentSession } = require("../payments/mfsPaymentService");

const SESSION_TTL_MS = 30 * 60 * 1000;
const pendingCheckouts = new Map();

function getSaasBillingProvider() {
  return String(process.env.SAAS_BILLING_PROVIDER || "log").trim().toLowerCase();
}

function pruneSessions() {
  const now = Date.now();
  for (const [id, row] of pendingCheckouts.entries()) {
    if (row.expiresAt < now) pendingCheckouts.delete(id);
  }
}

async function initiateSubscriptionCheckout({ orgId, branchId, planCode, billingEmail }) {
  pruneSessions();
  const plan = PLANS[String(planCode || "").toLowerCase()];
  if (!plan || plan.code === "trial") throw new Error("Invalid plan code");
  const amount = Number(plan.bdtMonthlyFee || 0);
  if (!(amount > 0)) throw new Error("Selected plan has no monthly fee");

  const provider = getSaasBillingProvider();
  const checkoutId = `SUB-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const session = {
    checkoutId,
    orgId: Number(orgId),
    branchId: Number(branchId),
    planCode: plan.code,
    amount,
    billingEmail: billingEmail ? String(billingEmail).trim().slice(0, 191) : null,
    provider,
    mfsPaymentId: null,
    status: "PENDING",
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  if (provider === "bkash") {
    const mfs = await initiatePayment({
      branchId,
      method: "bKash",
      amount,
      invoiceRef: `SUB-${orgId}-${plan.code}-${Date.now()}`,
      merchantName: "BD Smart POS Subscription",
    });
    session.mfsPaymentId = mfs.paymentId;
    session.paymentUrl = mfs.paymentUrl;
    session.qrPayload = mfs.qrPayload;
  }

  pendingCheckouts.set(checkoutId, session);
  return session;
}

function getSubscriptionCheckout(checkoutId) {
  pruneSessions();
  return pendingCheckouts.get(String(checkoutId || "")) || null;
}

async function completeSubscriptionCheckout({ checkoutId, paymentId, trxId }) {
  pruneSessions();
  const session = pendingCheckouts.get(String(checkoutId || ""));
  if (!session) throw new Error("Subscription checkout session not found or expired");

  const mfsPaymentId = String(paymentId || session.mfsPaymentId || "").trim();
  if (!mfsPaymentId) throw new Error("paymentId is required");

  const mfsSession = await getPaymentSession(mfsPaymentId);
  if (!mfsSession || Number(mfsSession.branchId) !== Number(session.branchId)) {
    throw new Error("MFS payment session not found or expired");
  }

  if (mfsSession.status !== "VERIFIED") {
    const trx = String(trxId || "").trim();
    if (!trx) throw new Error("TrxID required to verify subscription payment");
    await verifyPayment({ paymentId: mfsPaymentId, trxId: trx });
  }

  const refreshed = await getPaymentSession(mfsPaymentId);
  if (Math.abs(Number(refreshed.amount) - session.amount) > 0.05) {
    throw new Error("Paid amount does not match plan fee");
  }

  const updated = await upgradePlan(session.orgId, session.planCode, session.billingEmail);
  session.status = "COMPLETED";
  session.trxId = refreshed.trxId;
  pendingCheckouts.set(session.checkoutId, session);

  return { organization: updated, checkout: session };
}

module.exports = {
  getSaasBillingProvider,
  initiateSubscriptionCheckout,
  getSubscriptionCheckout,
  completeSubscriptionCheckout,
};
