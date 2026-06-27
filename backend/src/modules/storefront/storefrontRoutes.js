const express = require("express");
const { storefrontAuth } = require("../../middleware/storefrontAuth");
const {
  getStoreInfo,
  getCatalog,
  getTables,
  initiateMfsPayment,
  verifyMfsPayment,
  getMfsPaymentStatus,
  placeOrder,
} = require("./storefrontController");

const router = express.Router();

router.use(storefrontAuth);

router.get("/info", getStoreInfo);
router.get("/catalog", getCatalog);
router.get("/tables", getTables);
router.post("/mfs/initiate", initiateMfsPayment);
router.post("/mfs/verify", verifyMfsPayment);
router.get("/mfs/:id", getMfsPaymentStatus);
router.post("/order", placeOrder);

module.exports = router;
