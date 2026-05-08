const prisma = require("./prisma");

const MSG_NO_PERIOD =
  "No fiscal period covers today's date. Create or extend an open period under Finance → Fiscal periods.";
const MSG_CLOSED =
  "Fiscal period is closed for this date. Finance must reopen the period before sales can post.";

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
    return { ok: false, code: "FISCAL_PERIOD_BLOCKED", message: MSG_CLOSED };
  }
  return { ok: true, period };
}

async function ensureOpenFiscalPeriod(branchId, date = new Date()) {
  const gate = await getFiscalPeriodGate(branchId, date);
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
