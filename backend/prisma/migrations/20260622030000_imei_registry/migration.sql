-- IMEI registry for mobile handsets.
-- Products flagged `trackImei` capture a Luhn-validated IMEI at sale time; the
-- registry tracks each handset IMEI lifecycle (IN_STOCK -> SOLD/RETURNED/BLOCKED).

ALTER TABLE `Product`
  ADD COLUMN `trackImei` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `ImeiRecord` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branchId` INT NOT NULL,
  `imei` VARCHAR(32) NOT NULL,
  `productId` INT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'IN_STOCK',
  `saleId` INT NULL,
  `saleItemId` INT NULL,
  `customerId` INT NULL,
  `soldAt` DATETIME(3) NULL,
  `note` VARCHAR(191) NULL,
  `createdById` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ImeiRecord_branchId_imei_key` (`branchId`, `imei`),
  INDEX `ImeiRecord_branchId_status_idx` (`branchId`, `status`),
  INDEX `ImeiRecord_branchId_productId_idx` (`branchId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
