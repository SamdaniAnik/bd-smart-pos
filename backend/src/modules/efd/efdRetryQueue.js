// Background EFD submission retry sweeper.
//
// EFD/SDC submission on sale-create is intentionally non-fatal (a network blip
// at the fiscal device must never block a cash sale). This sweeper periodically
// re-submits sales that have no fiscal invoice number yet, with a bounded number
// of attempts per sale, so fiscalization eventually completes without manual
// intervention. Only active when a real EFD provider is configured.

const prisma = require("../../utils/prisma");
const logger = require("../../utils/logger");
const { submitSaleToEfd, getEfdProvider, isEfdConfigured } = require("./efdService");

const attemptCounts = new Map(); // saleId -> attempts
let timer = null;

function getConfig() {
  return {
    intervalMs: Math.max(60000, Number(process.env.EFD_RETRY_INTERVAL_MS || 5 * 60 * 1000)),
    maxAttempts: Math.max(1, Number(process.env.EFD_RETRY_MAX_ATTEMPTS || 6)),
    lookbackDays: Math.max(1, Number(process.env.EFD_RETRY_LOOKBACK_DAYS || 3)),
    batchSize: Math.max(1, Math.min(50, Number(process.env.EFD_RETRY_BATCH_SIZE || 20))),
  };
}

async function runOnce() {
  if (!isEfdConfigured()) return { skipped: true, reason: "efd-not-configured" };
  const { maxAttempts, lookbackDays, batchSize } = getConfig();
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const pending = await prisma.sale.findMany({
    where: {
      status: "completed",
      efdFiscalInvoiceNo: null,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    include: { items: { include: { product: true } }, branch: true },
  });

  let submitted = 0;
  let failed = 0;
  for (const sale of pending) {
    const attempts = attemptCounts.get(sale.id) || 0;
    if (attempts >= maxAttempts) continue;
    attemptCounts.set(sale.id, attempts + 1);
    try {
      const result = await submitSaleToEfd({ sale, branch: sale.branch });
      if (result.ok) {
        await prisma.sale.update({
          where: { id: sale.id },
          data: {
            efdFiscalInvoiceNo: result.fiscalInvoiceNo || null,
            efdQrPayload: result.qrPayload || null,
            efdVerificationUrl: result.verificationUrl || null,
            efdSubmittedAt: new Date(),
            efdProvider: result.provider || getEfdProvider(),
          },
        });
        attemptCounts.delete(sale.id);
        submitted += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      logger.warn({ saleId: sale.id, err: err.message }, "EFD retry sweep: submission error");
    }
  }

  if (submitted || failed) {
    logger.info({ submitted, failed, scanned: pending.length }, "EFD retry sweep complete");
  }
  return { submitted, failed, scanned: pending.length };
}

function start() {
  if (timer) return;
  if (String(process.env.EFD_RETRY_ENABLED || "true").toLowerCase() === "false") {
    logger.info("EFD retry sweeper disabled (EFD_RETRY_ENABLED=false)");
    return;
  }
  const { intervalMs } = getConfig();
  timer = setInterval(() => {
    runOnce().catch((err) => logger.error({ err: err.message }, "EFD retry sweep failed"));
  }, intervalMs);
  if (timer.unref) timer.unref();
  logger.info({ intervalMs }, "EFD retry sweeper started");
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, runOnce };
