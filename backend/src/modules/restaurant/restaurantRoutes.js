const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  listTables,
  createTable,
  updateTable,
  seatTable,
  requestTableBill,
  clearTable,
  billCollected,
  getTablePosCart,
  seedDefaultTables,
  createKitchenTicket,
  listKitchenTickets,
  updateKitchenTicketStatus,
  buildKotPrintLines,
  getStorefrontToken,
  generateStorefrontToken,
  getRestaurantSummary,
} = require("./restaurantController");

const router = express.Router();

router.get("/tables", requireAuth, requirePermission("sale.view"), listTables);
router.post("/tables", requireAuth, requirePermission("sale.create"), createTable);
router.post("/tables/seed", requireAuth, requirePermission("sale.create"), seedDefaultTables);
router.put("/tables/:id", requireAuth, requirePermission("sale.create"), updateTable);
router.patch("/tables/:id", requireAuth, requirePermission("sale.create"), updateTable);
router.post("/tables/:id/seat", requireAuth, requirePermission("sale.create"), seatTable);
router.post("/tables/:id/request-bill", requireAuth, requirePermission("sale.create"), requestTableBill);
router.post("/tables/:id/bill-collected", requireAuth, requirePermission("sale.create"), billCollected);
router.post("/tables/:id/clear", requireAuth, requirePermission("sale.create"), clearTable);
router.get("/tables/:id/pos-cart", requireAuth, requirePermission("sale.view"), getTablePosCart);

router.get("/kot", requireAuth, requirePermission("sale.view"), listKitchenTickets);
router.post("/kot", requireAuth, requirePermission("sale.create"), createKitchenTicket);
router.patch("/kot/:id/status", requireAuth, requirePermission("sale.create"), updateKitchenTicketStatus);
router.get("/kot/:id/print-lines", requireAuth, requirePermission("sale.view"), buildKotPrintLines);

router.get("/summary", requireAuth, requirePermission("sale.view"), getRestaurantSummary);

router.get("/storefront-token", requireAuth, requirePermission("sale.view"), getStorefrontToken);
router.post("/storefront-token", requireAuth, requirePermission("branch.manage"), generateStorefrontToken);

module.exports = router;
