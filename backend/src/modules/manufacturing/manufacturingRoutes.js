const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  listRecipes,
  createRecipe,
  updateRecipe,
  listProductionOrders,
  runProduction,
  listManufacturingProducts,
} = require("./manufacturingController");

const router = express.Router();

router.get("/products", requireAuth, requirePermission("inventory.view"), listManufacturingProducts);
router.get("/recipes", requireAuth, requirePermission("inventory.view"), listRecipes);
router.post("/recipes", requireAuth, requirePermission("inventory.adjust"), createRecipe);
router.put("/recipes/:id", requireAuth, requirePermission("inventory.adjust"), updateRecipe);
router.get("/production", requireAuth, requirePermission("inventory.view"), listProductionOrders);
router.post("/production", requireAuth, requirePermission("inventory.adjust"), runProduction);

module.exports = router;
