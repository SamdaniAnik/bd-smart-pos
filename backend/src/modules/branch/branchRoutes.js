const express = require("express");
const {
  createBranch,
  getBranches,
  getBranchDetails,
  updateBranch,
  updateBranchBusinessProfile,
  deleteBranch,
} = require("./branchController");
const { requireAuth, requirePermission } = require("../../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, getBranches);
router.post("/", requireAuth, requirePermission("branch.manage"), createBranch);
router.get("/:id", requireAuth, requirePermission("branch.manage"), getBranchDetails);
router.put("/:id", requireAuth, requirePermission("branch.manage"), updateBranch);
router.patch(
  "/:id/business-profile",
  requireAuth,
  requirePermission("branch.manage"),
  updateBranchBusinessProfile
);
router.delete("/:id", requireAuth, requirePermission("branch.manage"), deleteBranch);

module.exports = router;
