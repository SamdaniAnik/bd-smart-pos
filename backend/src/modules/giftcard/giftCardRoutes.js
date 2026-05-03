const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  issueGiftCard,
  listGiftCards,
  validateGiftCard,
  loadCustomerWallet,
} = require("./giftCardController");

const router = express.Router();

router.post("/issue", requireAuth, requirePermission("customer.view"), issueGiftCard);
router.get("/", requireAuth, requirePermission("customer.view"), listGiftCards);
router.post("/validate", requireAuth, requirePermission("sale.create"), validateGiftCard);
router.post("/wallet-load", requireAuth, requirePermission("customer.view"), loadCustomerWallet);

module.exports = router;
