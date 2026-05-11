const prisma = require("./prisma");
const { writeAuditLog } = require("./audit");

const MSG_NO_PERIOD =
  "No fiscal period covers today's date. Create or extend an open period under Finance → Fiscal periods.";
const MSG_CLOSED =
  "Fiscal period is closed for this date. Finance must reopen the period before sales can post.";
const MSG_LOCK_MATURITY =
  "This closed period has reached lock maturity. Only users with maturity-override permission can bypass.";
const LOCK_MATURITY_DAYS = Number(process.env.FINANCIAL_LOCK_MATURITY_DAYS || 45);
const MSG_OVERRIDE_META_REQUIRED =
  "Override reason and ticket/reference number are required for Procurement & Payables overrides.";

async function getOverrideQuotaForRole(roleName = "") {
  const normalized = String(roleName || "").trim().toLowerCase();
  const defaults = {
    admin: 9999,
    manager: 30,
    accountant: 15,
  };
  const latestConfig = await prisma.auditLog.findFirst({
    where: {
      action: "FINANCIAL_OVERRIDE_QUOTA_CONFIG",
      entity: "System",
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const mapFromDb = latestConfig?.payload?.map;
  if (mapFromDb && typeof mapFromDb === "object" && Number.isFinite(Number(mapFromDb[normalized]))) {
    return Math.max(0, Number(mapFromDb[normalized]));
  }
  const rawMap = String(process.env.FINANCIAL_OVERRIDE_QUOTA_MAP || "").trim();
  if (rawMap) {
    try {
      const parsed = JSON.parse(rawMap);
      if (parsed && Number.isFinite(Number(parsed[normalized]))) {
        return Math.max(0, Number(parsed[normalized]));
      }
    } catch {
      // ignore malformed JSON; use defaults.
    }
  }
  return defaults[normalized] != null ? defaults[normalized] : Number(process.env.FINANCIAL_OVERRIDE_MONTHLY_QUOTA_PER_ROLE || 10);
}

async function getMonthlyOverrideUsageCount({ roleName = "", overrideDomain = "" }) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const and = [];
  if (roleName) and.push({ payload: { path: ["roleName"], equals: roleName } });
  if (overrideDomain) and.push({ payload: { path: ["overrideDomain"], equals: overrideDomain } });
  return prisma.auditLog.count({
    where: {
      action: "FINANCIAL_LOCK_BYPASS",
      createdAt: { gte: monthStart, lte: monthEnd },
      ...(and.length ? { AND: and } : {}),
    },
  });
}

class FiscalPeriodBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "FiscalPeriodBlockedError";
    /** Business code surfaced to API clients (HTTP 400). */
    this.code = "FISCAL_PERIOD_BLOCKED";
    /** For handlers using httpStatus-style branching */
    this.httpStatus = 400;
  }
}

/**
 * If err is a blocked fiscal period, sends JSON 400 { error, code } and returns true.
 * If headers were already sent, returns true without sending (prevents double responses).
 */
function respondFiscalBlocked(res, err) {
  if (!(err instanceof FiscalPeriodBlockedError)) return false;
  if (res.headersSent) return true;
  res.status(400).json({ error: err.message, code: err.code });
  return true;
}

/**
 * @returns {Promise<{ ok: true, period: object } | { ok: false, code: string, message: string }>}
 */
async function getFiscalPeriodGate(branchId, date = new Date()) {
  const period = await prisma.fiscalPeriod.findFirst({
    where: {
      branchId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });
  if (!period) {
    return { ok: false, code: "FISCAL_PERIOD_BLOCKED", message: MSG_NO_PERIOD };
  }
  if (period.isClosed) {
    return { ok: false, code: "FISCAL_PERIOD_BLOCKED", message: MSG_CLOSED, period };
  }
  return { ok: true, period };
}

async function ensureOpenFiscalPeriod(branchId, date = new Date(), opts = {}) {
  const gate = await getFiscalPeriodGate(branchId, date);
  const hasOverride =
    gate.ok === false &&
    gate.message === MSG_CLOSED &&
    opts &&
    opts.permissions &&
    typeof opts.permissions.has === "function" &&
    opts.permissions.has("financial.lock.override");
  if (hasOverride) {
    const actionName = String(opts.actionName || "");
    const overrideDomain = actionName.startsWith("purchase.") ? "PROCUREMENT_PAYABLES" : "GENERAL";
    const overrideReason = String(opts.overrideReason || "").trim();
    const overrideRefNo = String(opts.overrideRefNo || "").trim();
    if (overrideDomain === "PROCUREMENT_PAYABLES" && (!overrideReason || !overrideRefNo)) {
      throw new FiscalPeriodBlockedError(MSG_OVERRIDE_META_REQUIRED);
    }
    const roleName = String(opts.roleName || "");
    const quota = await getOverrideQuotaForRole(roleName);
    const usageCount = await getMonthlyOverrideUsageCount({ roleName, overrideDomain });
    if (quota >= 0 && usageCount >= quota) {
      throw new FiscalPeriodBlockedError(
        `Monthly override quota reached for role ${roleName || "Unknown"} (${usageCount}/${quota}).`
      );
    }
    const periodEnd = gate?.period?.endDate instanceof Date ? gate.period.endDate : null;
    const ageDays = periodEnd ? Math.floor((Date.now() - periodEnd.getTime()) / (24 * 60 * 60 * 1000)) : 0;
    const hasMaturityOverride =
      opts &&
      opts.permissions &&
      typeof opts.permissions.has === "function" &&
      opts.permissions.has("financial.lock.maturity.override");
    if (ageDays >= LOCK_MATURITY_DAYS && !hasMaturityOverride) {
      throw new FiscalPeriodBlockedError(MSG_LOCK_MATURITY);
    }
    await writeAuditLog({
      userId: opts.userId || null,
      action: "FINANCIAL_LOCK_BYPASS",
      entity: "FiscalPeriod",
      entityId: null,
      payload: {
        branchId,
        actionName: opts.actionName || "financial_posting",
        date: date instanceof Date ? date.toISOString() : null,
        roleName: roleName || "",
        overrideDomain,
        overrideReason,
        overrideRefNo,
        quota,
        monthUsageAfter: usageCount + 1,
      },
    });
    return gate.period || null;
  }
  if (!gate.ok) {
    throw new FiscalPeriodBlockedError(gate.message);
  }
  return gate.period;
}

module.exports = {
  ensureOpenFiscalPeriod,
  getFiscalPeriodGate,
  FiscalPeriodBlockedError,
  respondFiscalBlocked,
};
