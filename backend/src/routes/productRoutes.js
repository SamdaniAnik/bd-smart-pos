const express = require("express");
const router = express.Router();

const {
  createProduct,
  getProducts,
  findProductByCode,
  getProductDetails,
  updateProduct,
  deleteProduct,
  listProductVariants,
  createProductVariant,
  updateProductVariant,
  deleteProductVariant,
} = require("../controllers/productController");
const { requireAuth, requirePermission } = require("../middleware/auth");

router.post("/", requireAuth, requirePermission("product.create"), createProduct);
router.get("/", requireAuth, requirePermission("product.view"), getProducts);
router.get("/search/by-code", requireAuth, requirePermission("product.view"), findProductByCode);
router.get("/:id/variants", requireAuth, requirePermission("product.view"), listProductVariants);
router.post("/:id/variants", requireAuth, requirePermission("product.create"), createProductVariant);
router.put("/:id/variants/:variantId", requireAuth, requirePermission("product.create"), updateProductVariant);
router.delete("/:id/variants/:variantId", requireAuth, requirePermission("product.create"), deleteProductVariant);
router.get("/:id", requireAuth, requirePermission("product.view"), getProductDetails);
router.put("/:id", requireAuth, requirePermission("product.create"), updateProduct);
router.delete("/:id", requireAuth, requirePermission("product.create"), deleteProduct);

module.exports = router;