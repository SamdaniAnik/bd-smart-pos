const express = require("express");
const { otpRateLimiter } = require("../../middleware/security");
const {
  requestLoyaltyOtp,
  verifyLoyaltyOtp,
  getLoyaltyCardInfo,
} = require("./loyaltyPublicController");

const router = express.Router();

router.get("/card", getLoyaltyCardInfo);
router.post("/otp/request", otpRateLimiter, requestLoyaltyOtp);
router.post("/otp/verify", otpRateLimiter, verifyLoyaltyOtp);

module.exports = router;
