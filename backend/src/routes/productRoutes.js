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
  listProductBarcodes,
  createProductBarcode,
  deleteProductBarcode,
  listProductPriceLists,
  createProductPriceList,
  deleteProductPriceList,
} = require("../controllers/productController");
const { requireAuth, requirePermission } = require("../middleware/auth");

router.post("/", requireAuth, requirePermission("product.create"), createProduct);
router.get("/", requireAuth, requirePermission("product.view"), getProducts);
router.get("/search/by-code", requireAuth, requirePermission("product.view"), findProductByCode);
router.get("/:id/variants", requireAuth, requirePermission("product.view"), listProductVariants);
router.post("/:id/variants", requireAuth, requirePermission("product.create"), createProductVariant);
router.put("/:id/variants/:variantId", requireAuth, requirePermission("product.create"), updateProductVariant);
router.delete("/:id/variants/:variantId", requireAuth, requirePermission("product.create"), deleteProductVariant);
router.get("/:id/barcodes", requireAuth, requirePermission("product.view"), listProductBarcodes);
router.post("/:id/barcodes", requireAuth, requirePermission("product.create"), createProductBarcode);
router.delete("/:id/barcodes/:barcodeId", requireAuth, requirePermission("product.create"), deleteProductBarcode);
router.get("/:id/price-lists", requireAuth, requirePermission("product.view"), listProductPriceLists);
router.post("/:id/price-lists", requireAuth, requirePermission("product.create"), createProductPriceList);
router.delete("/:id/price-lists/:priceListId", requireAuth, requirePermission("product.create"), deleteProductPriceList);
router.get("/:id", requireAuth, requirePermission("product.view"), getProductDetails);
router.put("/:id", requireAuth, requirePermission("product.create"), updateProduct);
router.delete("/:id", requireAuth, requirePermission("product.create"), deleteProduct);

module.exports = router;