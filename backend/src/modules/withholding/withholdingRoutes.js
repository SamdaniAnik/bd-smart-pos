const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  listTaxCategories,
  previewSupplierPayment,
  paySupplierWithholding,
  getMushak66Pdf,
  getAitRegister,
  getVdsRegister,
  exportAitRegisterCsv,
  exportVdsRegisterCsv,
} = require("./withholdingController");

const router = express.Router();

router.get("/tax-categories", requireAuth, listTaxCategories);
router.post("/preview-payment", requireAuth, requirePermission("supplier.view"), previewSupplierPayment);
router.post("/pay-supplier", requireAuth, requirePermission("supplier.create"), paySupplierWithholding);
router.get("/vouchers/:id/mushak66.pdf", requireAuth, requirePermission("supplier.view"), getMushak66Pdf);
router.get("/registers/ait", requireAuth, requirePermission("report.view"), getAitRegister);
router.get("/registers/vds", requireAuth, requirePermission("report.view"), getVdsRegister);
router.get("/registers/ait/export.csv", requireAuth, requirePermission("report.view"), exportAitRegisterCsv);
router.get("/registers/vds/export.csv", requireAuth, requirePermission("report.view"), exportVdsRegisterCsv);

module.exports = router;
