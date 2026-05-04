const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  importSettlement,
  listSettlements,
  listUnmatchedPayments,
} = require("./settlementController");
const {
  listBankImports,
  createBankImport,
  getBankImportLines,
  matchBankLineToPayment,
  unmatchBankLine,
  getChequeReconcileWorkspace,
  matchBankLineToCheque,
  unmatchBankLineCheque,
  postReconcileAdjustmentJournal,
  createBankLineAllocation,
  deleteBankLineAllocation,
  closeBankImport,
  reopenBankImport,
  runAutoMatchForImport,
  previewAutoMatchForImport,
  applyAutoMatchSelections,
  getBankReconciliationSnapshot,
  exportBankReconciliationSnapshotCSV,
  flagBankLineException,
  resolveBankLineException,
} = require("./bankStatementController");

const router = express.Router();

router.post("/settlements/import", requireAuth, requirePermission("accounting.report"), importSettlement);
router.get("/settlements", requireAuth, requirePermission("accounting.report"), listSettlements);
router.get(
  "/settlements/unmatched-payments",
  requireAuth,
  requirePermission("accounting.report"),
  listUnmatchedPayments
);

router.get("/bank/imports", requireAuth, requirePermission("accounting.report"), listBankImports);
router.post("/bank/imports", requireAuth, requirePermission("accounting.report"), createBankImport);
router.get("/bank/imports/:importId/lines", requireAuth, requirePermission("accounting.report"), getBankImportLines);
router.post("/bank/lines/:lineId/match", requireAuth, requirePermission("accounting.report"), matchBankLineToPayment);
router.delete("/bank/lines/:lineId/match", requireAuth, requirePermission("accounting.report"), unmatchBankLine);
router.get(
  "/bank/imports/:importId/cheque-workspace",
  requireAuth,
  requirePermission("accounting.report"),
  getChequeReconcileWorkspace
);
router.post(
  "/bank/lines/:lineId/match-cheque",
  requireAuth,
  requirePermission("accounting.report"),
  matchBankLineToCheque
);
router.delete(
  "/bank/lines/:lineId/match-cheque",
  requireAuth,
  requirePermission("accounting.report"),
  unmatchBankLineCheque
);
router.post(
  "/bank/imports/:importId/reconcile-adjustment-journal",
  requireAuth,
  requirePermission("accounting.journal.create"),
  postReconcileAdjustmentJournal
);
router.post("/bank/lines/:lineId/allocations", requireAuth, requirePermission("accounting.report"), createBankLineAllocation);
router.delete(
  "/bank/allocations/:allocId",
  requireAuth,
  requirePermission("accounting.report"),
  deleteBankLineAllocation
);
router.post("/bank/imports/:importId/close", requireAuth, requirePermission("accounting.report"), closeBankImport);
router.post("/bank/imports/:importId/reopen", requireAuth, requirePermission("accounting.report"), reopenBankImport);
router.post("/bank/imports/:importId/auto-match", requireAuth, requirePermission("accounting.report"), runAutoMatchForImport);
router.post("/bank/imports/:importId/auto-match/preview", requireAuth, requirePermission("accounting.report"), previewAutoMatchForImport);
router.post(
  "/bank/imports/:importId/auto-match/apply-selected",
  requireAuth,
  requirePermission("accounting.report"),
  applyAutoMatchSelections
);
router.get("/bank/reconciliation-snapshot", requireAuth, requirePermission("accounting.report"), getBankReconciliationSnapshot);
router.get(
  "/bank/reconciliation-snapshot/export.csv",
  requireAuth,
  requirePermission("accounting.report"),
  exportBankReconciliationSnapshotCSV
);
router.post("/bank/lines/:lineId/exception", requireAuth, requirePermission("accounting.report"), flagBankLineException);
router.post(
  "/bank/lines/:lineId/exception/resolve",
  requireAuth,
  requirePermission("accounting.report"),
  resolveBankLineException
);

module.exports = router;
