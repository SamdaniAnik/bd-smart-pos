const express = require("express");
const { requireAuth, requirePermission } = require("../../middleware/auth");
const {
  listAssets,
  createAsset,
  updateAsset,
  disposeAsset,
  runDepreciation,
  listDepreciationEntries,
} = require("./assetController");

const router = express.Router();

router.get("/", requireAuth, requirePermission("asset.view"), listAssets);
router.post("/", requireAuth, requirePermission("asset.manage"), createAsset);
router.patch("/:id", requireAuth, requirePermission("asset.manage"), updateAsset);
router.post("/:id/dispose", requireAuth, requirePermission("asset.manage"), disposeAsset);
router.post("/depreciation/run", requireAuth, requirePermission("asset.manage"), runDepreciation);
router.get("/depreciation/entries", requireAuth, requirePermission("asset.view"), listDepreciationEntries);

module.exports = router;
