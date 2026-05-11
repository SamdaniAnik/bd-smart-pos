const express = require("express");
const {
  createSupplier,
  getSuppliers,
  getSupplierDetails,
  updateSupplier,
  deleteSupplier,
  createCustomer,
  getCustomers,
  getCustomerDetails,
  updateCustomer,
  getCustomerLoyaltyRanking,
  lookupCustomerByPhone,
  exportCustomerLoyaltyRankingCSV,
  exportCustomerLoyaltyRankingPDF,
  exportCustomerLoyaltyRankingXLSX,
  getCustomerRetentionSummary,
  exportCustomerRetentionCampaignCSV,
  runCustomerRetentionAutomation,
  getCustomerRetentionAutomationHistory,
  getCustomerAccountStatementPdf,
  getFeatureReadiness,
  listProductCategories,
  createProductCategory,
  updateProductCategory,
  deleteProductCategory,
} = require("./masterController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/suppliers", requireAuth, requirePermission("supplier.view"), getSuppliers);
router.post("/suppliers", requireAuth, requirePermission("supplier.create"), createSupplier);
router.get("/suppliers/:id", requireAuth, requirePermission("supplier.view"), getSupplierDetails);
router.put("/suppliers/:id", requireAuth, requirePermission("supplier.create"), updateSupplier);
router.delete("/suppliers/:id", requireAuth, requirePermission("supplier.create"), deleteSupplier);
router.get("/customers", requireAuth, requirePermission("customer.view"), getCustomers);
router.get("/customers/lookup", requireAuth, requirePermission("customer.view"), lookupCustomerByPhone);
router.get("/customers/loyalty", requireAuth, requirePermission("customer.view"), getCustomerLoyaltyRanking);
router.get("/customers/retention", requireAuth, requirePermission("customer.view"), getCustomerRetentionSummary);
router.get(
  "/customers/retention/automation",
  requireAuth,
  requirePermission("customer.view"),
  getCustomerRetentionAutomationHistory
);
router.post(
  "/customers/retention/automation",
  requireAuth,
  requirePermission("customer.create"),
  runCustomerRetentionAutomation
);
router.get(
  "/customers/retention/export.csv",
  requireAuth,
  requirePermission("customer.view"),
  exportCustomerRetentionCampaignCSV
);
router.get("/customers/loyalty/export.csv", requireAuth, requirePermission("customer.view"), exportCustomerLoyaltyRankingCSV);
router.get("/customers/loyalty/export.pdf", requireAuth, requirePermission("customer.view"), exportCustomerLoyaltyRankingPDF);
router.get("/customers/loyalty/export.xlsx", requireAuth, requirePermission("customer.view"), exportCustomerLoyaltyRankingXLSX);
router.post("/customers", requireAuth, requirePermission("customer.create"), createCustomer);
router.get(
  "/customers/:id/account-statement.pdf",
  requireAuth,
  requirePermission("customer.view"),
  getCustomerAccountStatementPdf
);
router.get("/customers/:id", requireAuth, requirePermission("customer.view"), getCustomerDetails);
router.put("/customers/:id", requireAuth, requirePermission("customer.create"), updateCustomer);
router.get("/feature-readiness", requireAuth, requirePermission("rbac.manage"), getFeatureReadiness);
router.get("/product-categories", requireAuth, requirePermission("product.view"), listProductCategories);
router.post("/product-categories", requireAuth, requirePermission("product.create"), createProductCategory);
router.put("/product-categories/:id", requireAuth, requirePermission("product.create"), updateProductCategory);
router.delete("/product-categories/:id", requireAuth, requirePermission("product.create"), deleteProductCategory);

module.exports = router;
