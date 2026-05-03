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

module.exports = router;
