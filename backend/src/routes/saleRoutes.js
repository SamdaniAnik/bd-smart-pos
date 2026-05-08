const express = require("express");
const router = express.Router();

const {
  checkout,
  saleReturn,
  getRecentSales,
  getTodaySummary,
  getTodaySettlement,
  exportTodaySettlementMethodCSV,
  exportTodaySettlementChannelCSV,
  exportTodaySettlementMethodPDF,
  exportTodaySettlementChannelPDF,
  getLoyaltyRedemptionHistory,
  exportLoyaltyRedemptionHistoryCSV,
  exportLoyaltyRedemptionHistoryPDF,
  exportLoyaltyRedemptionHistoryXLSX,
  getSaleInvoice,
  getSalePayments,
  getSaleMushakPdf,
  createHeldCart,
  getHeldCarts,
  discardHeldCart,
  resumeHeldCart,
  createSalesQuote,
  listSalesQuotes,
  loadSalesQuoteDraft,
  cancelSalesQuote,
  duplicateSalesQuote,
  getSalesQuotePdf,
  setSalesQuoteFollowUp,
  getSalesQuoteReminderSummary,
  markSalesQuoteFollowUpDone,
  getCustomerRecentSales,
  getSaleByInvoiceLookup,
} = require("../controllers/saleController");
const { requireAuth, requirePermission } = require("../middleware/auth");

router.post("/checkout", requireAuth, requirePermission("sale.create"), checkout);
router.post("/:id/return", requireAuth, requirePermission("sale.return"), saleReturn);
router.get("/recent", requireAuth, requirePermission("sale.view"), getRecentSales);
router.get("/lookup/by-invoice", requireAuth, requirePermission("sale.view"), getSaleByInvoiceLookup);
router.get("/customer/recent-sales", requireAuth, requirePermission("sale.view"), getCustomerRecentSales);
router.get("/summary/today", requireAuth, requirePermission("sale.view"), getTodaySummary);
router.get("/summary/settlement-today", requireAuth, requirePermission("sale.view"), getTodaySettlement);
router.get("/summary/settlement-today/export-method.csv", requireAuth, requirePermission("sale.view"), exportTodaySettlementMethodCSV);
router.get("/summary/settlement-today/export-channel.csv", requireAuth, requirePermission("sale.view"), exportTodaySettlementChannelCSV);
router.get("/summary/settlement-today/export-method.pdf", requireAuth, requirePermission("sale.view"), exportTodaySettlementMethodPDF);
router.get("/summary/settlement-today/export-channel.pdf", requireAuth, requirePermission("sale.view"), exportTodaySettlementChannelPDF);
router.get("/loyalty/redemptions", requireAuth, requirePermission("sale.view"), getLoyaltyRedemptionHistory);
router.get("/loyalty/redemptions/export.csv", requireAuth, requirePermission("sale.view"), exportLoyaltyRedemptionHistoryCSV);
router.get("/loyalty/redemptions/export.pdf", requireAuth, requirePermission("sale.view"), exportLoyaltyRedemptionHistoryPDF);
router.get("/loyalty/redemptions/export.xlsx", requireAuth, requirePermission("sale.view"), exportLoyaltyRedemptionHistoryXLSX);
router.post("/holds", requireAuth, requirePermission("sale.create"), createHeldCart);
router.get("/holds", requireAuth, requirePermission("sale.view"), getHeldCarts);
router.post("/holds/:id/resume", requireAuth, requirePermission("sale.create"), resumeHeldCart);
router.delete("/holds/:id", requireAuth, requirePermission("sale.create"), discardHeldCart);
router.post("/quotes", requireAuth, requirePermission("sale.create"), createSalesQuote);
router.get("/quotes", requireAuth, requirePermission("sale.view"), listSalesQuotes);
router.get("/quotes/reminders/summary", requireAuth, requirePermission("sale.view"), getSalesQuoteReminderSummary);
router.post("/quotes/:id/load", requireAuth, requirePermission("sale.create"), loadSalesQuoteDraft);
router.post("/quotes/:id/follow-up", requireAuth, requirePermission("sale.create"), setSalesQuoteFollowUp);
router.post("/quotes/:id/follow-up-done", requireAuth, requirePermission("sale.create"), markSalesQuoteFollowUpDone);
router.post("/quotes/:id/duplicate", requireAuth, requirePermission("sale.create"), duplicateSalesQuote);
router.delete("/quotes/:id", requireAuth, requirePermission("sale.create"), cancelSalesQuote);
router.get("/quotes/:id/pdf", requireAuth, requirePermission("sale.view"), getSalesQuotePdf);
router.get("/:id/payments", requireAuth, requirePermission("sale.view"), getSalePayments);
router.get("/:id/mushak-pdf", requireAuth, requirePermission("sale.view"), getSaleMushakPdf);
router.get("/:id/invoice", requireAuth, requirePermission("sale.view"), getSaleInvoice);

module.exports = router;