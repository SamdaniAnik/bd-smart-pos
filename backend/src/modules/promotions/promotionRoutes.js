const express = require("express");
const {
  listPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
} = require("./promotionController");
const {
  listCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} = require("./couponController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/coupons", requireAuth, requirePermission("product.view"), listCoupons);
router.post("/coupons", requireAuth, requirePermission("product.create"), createCoupon);
router.put("/coupons/:id", requireAuth, requirePermission("product.create"), updateCoupon);
router.delete("/coupons/:id", requireAuth, requirePermission("product.create"), deleteCoupon);

router.get("/", requireAuth, requirePermission("product.view"), listPromotions);
router.post("/", requireAuth, requirePermission("product.create"), createPromotion);
router.put("/:id", requireAuth, requirePermission("product.create"), updatePromotion);
router.delete("/:id", requireAuth, requirePermission("product.create"), deletePromotion);

module.exports = router;
