const prisma = require("./prisma");

const PLANS = {
  trial: { code: "trial", name: "Trial", bdtMonthlyFee: 0, maxBranches: 2, maxUsers: 5, trialDays: 30 },
  starter: { code: "starter", name: "Starter", bdtMonthlyFee: 1500, maxBranches: 3, maxUsers: 10, trialDays: 0 },
  pro: { code: "pro", name: "Pro", bdtMonthlyFee: 3500, maxBranches: 10, maxUsers: 50, trialDays: 0 },
};

function listPlans() {
  return Object.values(PLANS).map((p) => ({
    code: p.code,
    name: p.name,
    bdtMonthlyFee: p.bdtMonthlyFee,
    maxBranches: p.maxBranches,
    maxUsers: p.maxUsers,
  }));
}

async function ensureDefaultOrganization() {
  let org = await prisma.organization.findFirst({ orderBy: { id: "asc" } });
  if (!org) {
    const trialEnds = new Date();
    trialEnds.setDate(trialEnds.getDate() + 30);
    org = await prisma.organization.create({
      data: {
        code: "default",
        name: "Default Organization",
        planCode: "trial",
        subscriptionStatus: "TRIAL",
        trialEndsAt: trialEnds,
        bdtMonthlyFee: 0,
        maxBranches: 2,
        maxUsers: 5,
      },
    });
  }
  return org;
}

async function getOrganizationForBranch(branchId) {
  const branch = await prisma.branch.findUnique({
    where: { id: Number(branchId) },
    select: { organizationId: true },
  });
  if (!branch?.organizationId) {
    const org = await ensureDefaultOrganization();
    await prisma.branch.update({
      where: { id: Number(branchId) },
      data: { organizationId: org.id },
    });
    return org;
  }
  return prisma.organization.findUnique({ where: { id: branch.organizationId } });
}

function evaluateSubscription(org) {
  if (!org) return { active: true, status: "TRIAL", readOnly: false, message: null };
  const now = new Date();
  const status = String(org.subscriptionStatus || "TRIAL").toUpperCase();
  if (status === "ACTIVE") {
    const periodEnd = org.currentPeriodEnd ? new Date(org.currentPeriodEnd) : null;
    if (periodEnd && periodEnd < now) {
      return { active: false, status: "PAST_DUE", readOnly: true, message: "Subscription period ended" };
    }
    return { active: true, status: "ACTIVE", readOnly: false, message: null };
  }
  if (status === "TRIAL") {
    const trialEnd = org.trialEndsAt ? new Date(org.trialEndsAt) : null;
    if (trialEnd && trialEnd < now) {
      return { active: false, status: "TRIAL_EXPIRED", readOnly: true, message: "Trial expired — upgrade to continue" };
    }
    return { active: true, status: "TRIAL", readOnly: false, message: null };
  }
  if (status === "PAST_DUE" || status === "CANCELLED") {
    return { active: false, status, readOnly: true, message: "Subscription inactive" };
  }
  return { active: true, status, readOnly: false, message: null };
}

async function upgradePlan(orgId, planCode, billingEmail) {
  const plan = PLANS[String(planCode || "").toLowerCase()];
  if (!plan || plan.code === "trial") throw new Error("Invalid plan code");
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  return prisma.organization.update({
    where: { id: Number(orgId) },
    data: {
      planCode: plan.code,
      subscriptionStatus: "ACTIVE",
      bdtMonthlyFee: plan.bdtMonthlyFee,
      maxBranches: plan.maxBranches,
      maxUsers: plan.maxUsers,
      currentPeriodEnd: periodEnd,
      trialEndsAt: null,
      billingEmail: billingEmail ? String(billingEmail).trim().slice(0, 191) : undefined,
    },
  });
}

module.exports = {
  PLANS,
  listPlans,
  ensureDefaultOrganization,
  getOrganizationForBranch,
  evaluateSubscription,
  upgradePlan,
};
