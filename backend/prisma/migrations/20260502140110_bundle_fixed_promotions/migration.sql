-- AlterTable
ALTER TABLE `PromotionRule`
  ADD COLUMN `bundlePrice` DOUBLE NULL,
  ADD COLUMN `bundleProductIds` VARCHAR(191) NULL;
