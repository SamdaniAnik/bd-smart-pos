const express = require("express");
const { seedSystem } = require("./bootstrapController");

const router = express.Router();

router.post("/seed", seedSystem);

module.exports = router;
