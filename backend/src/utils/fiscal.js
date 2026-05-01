const prisma = require("./prisma");

async function ensureOpenFiscalPeriod(branchId, date = new Date()) {
  const period = await prisma.fiscalPeriod.findFirst({
    where: {
      branchId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });
  if (!period) {
    throw new Error("No fiscal period configured for transaction date");
  }
  if (period.isClosed) {
    throw new Error("Fiscal period is closed");
  }
  return period;
}

module.exports = { ensureOpenFiscalPeriod };
