const {
  listPlans,
  getOrganizationForBranch,
  evaluateSubscription,
  upgradePlan,
} = require("../../utils/subscriptionUtil");
const { writeAuditLog } = require("../../utils/audit");
const {
  getSaasBillingProvider,
  initiateSubscriptionCheckout,
  completeSubscriptionCheckout,
} = require("./billingPaymentService");

exports.getPlans = async (_req, res) => {
  res.json(listPlans());
};

exports.getSubscription = async (req, res) => {
  try {
    const org = await getOrganizationForBranch(req.branchId);
    const evalResult = evaluateSubscription(org);
    res.json({
      organization: org,
      evaluation: evalResult,
      billingProvider: getSaasBillingProvider(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.checkoutSubscription = async (req, res) => {
  try {
    const planCode = String(req.body?.planCode || "").trim();
    const billingEmail = req.body?.billingEmail;
    const org = await getOrganizationForBranch(req.branchId);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const provider = getSaasBillingProvider();
    if (provider === "log") {
      return res.status(400).json({
        error: "Live billing not configured. Set SAAS_BILLING_PROVIDER=bkash or use /subscription/upgrade for simulated mode.",
      });
    }

    const session = await initiateSubscriptionCheckout({
      orgId: org.id,
      branchId: req.branchId,
      planCode,
      billingEmail,
    });

    res.status(201).json({
      message: "Subscription checkout started",
      checkoutId: session.checkoutId,
      planCode: session.planCode,
      amount: session.amount,
      paymentId: session.mfsPaymentId,
      paymentUrl: session.paymentUrl,
      qrPayload: session.qrPayload,
      provider: session.provider,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.completeSubscription = async (req, res) => {
  try {
    const checkoutId = String(req.body?.checkoutId || "").trim();
    const paymentId = String(req.body?.paymentId || "").trim();
    const trxId = String(req.body?.trxId || "").trim();
    if (!checkoutId) return res.status(400).json({ error: "checkoutId is required" });

    const orgBefore = await getOrganizationForBranch(req.branchId);
    const { organization, checkout } = await completeSubscriptionCheckout({ checkoutId, paymentId, trxId });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "SUBSCRIPTION_PAID",
      entity: "Organization",
      entityId: organization.id,
      payload: { planCode: checkout.planCode, trxId: checkout.trxId, amount: checkout.amount },
    });

    res.json({
      message: "Subscription activated via bKash payment",
      organization,
      evaluation: evaluateSubscription(organization),
      previousPlan: orgBefore?.planCode || null,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.upgradeSubscription = async (req, res) => {
  try {
    const planCode = String(req.body?.planCode || "").trim();
    const billingEmail = req.body?.billingEmail;
    const provider = getSaasBillingProvider();
    if (provider !== "log") {
      return res.status(400).json({
        error: "Live billing enabled — use POST /billing/subscription/checkout then /billing/subscription/complete",
      });
    }

    const org = await getOrganizationForBranch(req.branchId);
    if (!org) return res.status(404).json({ error: "Organization not found" });
    const updated = await upgradePlan(org.id, planCode, billingEmail);
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "SUBSCRIPTION_UPGRADE",
      entity: "Organization",
      entityId: org.id,
      payload: { planCode, billingEmail: billingEmail || null, simulated: true },
    });
    res.json({
      message: "Subscription upgraded (simulated — set SAAS_BILLING_PROVIDER=bkash for live billing)",
      organization: updated,
      evaluation: evaluateSubscription(updated),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
