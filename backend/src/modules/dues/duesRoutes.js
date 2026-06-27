const express = require("express");
const {
  getDueSummary,
  collectCustomerDue,
  paySupplierDue,
  getCustomerCollections,
  getSupplierPayments,
  sendCustomerDueReminders,
  getBakirKhata,
  sendBakirKhataStatement,
} = require("./duesController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/summary", requireAuth, requirePermission("report.view"), getDueSummary);
router.get("/customer-collections", requireAuth, requirePermission("customer.view"), getCustomerCollections);
router.get("/supplier-payments", requireAuth, requirePermission("supplier.view"), getSupplierPayments);
router.post("/customer-collections", requireAuth, requirePermission("customer.create"), collectCustomerDue);
router.post("/customer-reminders", requireAuth, requirePermission("customer.create"), sendCustomerDueReminders);
router.get("/bakir-khata/:customerId", requireAuth, requirePermission("customer.view"), getBakirKhata);
router.post("/bakir-khata/:customerId/send-statement", requireAuth, requirePermission("customer.create"), sendBakirKhataStatement);
router.post("/supplier-payments", requireAuth, requirePermission("supplier.create"), paySupplierDue);

module.exports = router;
