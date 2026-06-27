-- Extended product master data (retail / pharmacy / apparel)

ALTER TABLE `Product` ADD COLUMN `description` TEXT NULL;
ALTER TABLE `Product` ADD COLUMN `shortDescription` VARCHAR(500) NULL;
ALTER TABLE `Product` ADD COLUMN `manufacturer` VARCHAR(191) NULL;
ALTER TABLE `Product` ADD COLUMN `countryOfOrigin` VARCHAR(64) NULL;
ALTER TABLE `Product` ADD COLUMN `genericName` VARCHAR(191) NULL;
ALTER TABLE `Product` ADD COLUMN `strength` VARCHAR(64) NULL;
ALTER TABLE `Product` ADD COLUMN `dosageForm` VARCHAR(64) NULL;
ALTER TABLE `Product` ADD COLUMN `drugRegNo` VARCHAR(64) NULL;
ALTER TABLE `Product` ADD COLUMN `mrp` DOUBLE NULL DEFAULT 0;
ALTER TABLE `Product` ADD COLUMN `tags` JSON NULL;
ALTER TABLE `Product` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `Product` ADD COLUMN `internalNotes` TEXT NULL;
ALTER TABLE `Product` ADD COLUMN `weightGrams` DOUBLE NULL;
ALTER TABLE `Product` ADD COLUMN `shelfLifeDays` INTEGER NULL;
ALTER TABLE `Product` ADD COLUMN `storageCondition` VARCHAR(64) NULL;

CREATE INDEX `Product_branchId_isActive_idx` ON `Product`(`branchId`, `isActive`);
