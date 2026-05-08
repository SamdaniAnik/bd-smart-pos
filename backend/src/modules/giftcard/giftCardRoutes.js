const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  issueGiftCard,
  listGiftCards,
  validateGiftCard,
  loadCustomerWallet,
  listWalletBalances,
  cashOutCustomerWallet,
  listWalletTransactions,
  exportWalletTransactionsCsv,
} = require("./giftCardController");

const router = express.Router();

router.post("/issue", requireAuth, requirePermission("customer.view"), issueGiftCard);
router.get("/", requireAuth, requirePermission("customer.view"), listGiftCards);
router.post("/validate", requireAuth, requirePermission("sale.create"), validateGiftCard);
router.post("/wallet-load", requireAuth, requirePermission("customer.view"), loadCustomerWallet);
router.get("/wallet-balances", requireAuth, requirePermission("customer.view"), listWalletBalances);
router.get("/wallet-transactions", requireAuth, requirePermission("customer.view"), listWalletTransactions);
router.get("/wallet-transactions/export.csv", requireAuth, requirePermission("customer.view"), exportWalletTransactionsCsv);
router.post("/wallet-cash-out", requireAuth, requirePermission("customer.view"), cashOutCustomerWallet);

module.exports = router;
