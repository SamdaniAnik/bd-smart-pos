-- BD-market product detail enrichment:
-- Supplementary Duty, NBR product/service code, BSTI & Halal certification,
-- importer info, product condition, pack/carton hierarchy, weights & dimensions,
-- and order qty / lead-time fields for wholesale and courier logistics.

ALTER TABLE `Product`
  ADD COLUMN `sdRate` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `nbrProductCode` VARCHAR(191) NULL,
  ADD COLUMN `bstiCertNo` VARCHAR(191) NULL,
  ADD COLUMN `isHalalCertified` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `halalCertNo` VARCHAR(191) NULL,
  ADD COLUMN `importerName` VARCHAR(191) NULL,
  ADD COLUMN `importerAddress` TEXT NULL,
  ADD COLUMN `productCondition` VARCHAR(191) NULL,
  ADD COLUMN `purchaseUnit` VARCHAR(191) NULL,
  ADD COLUMN `unitsPerPack` INT NULL,
  ADD COLUMN `packsPerCarton` INT NULL,
  ADD COLUMN `netWeightGrams` DOUBLE NULL,
  ADD COLUMN `grossWeightGrams` DOUBLE NULL,
  ADD COLUMN `lengthCm` DOUBLE NULL,
  ADD COLUMN `widthCm` DOUBLE NULL,
  ADD COLUMN `heightCm` DOUBLE NULL,
  ADD COLUMN `minOrderQty` INT NULL,
  ADD COLUMN `maxOrderQty` INT NULL,
  ADD COLUMN `leadTimeDays` INT NULL;
