-- Customer structured address & B2B fields
ALTER TABLE `Customer`
  ADD COLUMN `district` VARCHAR(191) NULL,
  ADD COLUMN `area` VARCHAR(191) NULL,
  ADD COLUMN `landmark` VARCHAR(191) NULL,
  ADD COLUMN `customerType` VARCHAR(32) NOT NULL DEFAULT 'RETAIL',
  ADD COLUMN `buyerBin` VARCHAR(64) NULL,
  ADD COLUMN `companyName` VARCHAR(191) NULL,
  ADD COLUMN `whatsappOptIn` BOOLEAN NOT NULL DEFAULT false;

-- Sale delivery / order source
ALTER TABLE `Sale`
  ADD COLUMN `fulfillmentType` VARCHAR(16) NOT NULL DEFAULT 'PICKUP',
  ADD COLUMN `deliveryFee` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `deliveryAddress` VARCHAR(500) NULL,
  ADD COLUMN `deliveryDistrict` VARCHAR(191) NULL,
  ADD COLUMN `deliveryArea` VARCHAR(191) NULL,
  ADD COLUMN `deliveryLandmark` VARCHAR(191) NULL,
  ADD COLUMN `courierName` VARCHAR(191) NULL,
  ADD COLUMN `trackingId` VARCHAR(191) NULL,
  ADD COLUMN `orderSource` VARCHAR(32) NULL,
  ADD COLUMN `pendingOrderId` INT NULL;

-- Phone / Facebook / WhatsApp order inbox
CREATE TABLE `PendingOrder` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branchId` INT NOT NULL,
  `orderNo` VARCHAR(64) NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'PHONE',
  `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  `customerName` VARCHAR(191) NOT NULL,
  `customerPhone` VARCHAR(32) NULL,
  `district` VARCHAR(191) NULL,
  `area` VARCHAR(191) NULL,
  `landmark` VARCHAR(191) NULL,
  `deliveryAddress` VARCHAR(500) NULL,
  `deliveryFee` DOUBLE NOT NULL DEFAULT 0,
  `courierName` VARCHAR(191) NULL,
  `trackingId` VARCHAR(191) NULL,
  `paymentMethod` VARCHAR(32) NULL,
  `notes` TEXT NULL,
  `cartJson` MEDIUMTEXT NOT NULL,
  `saleId` INT NULL,
  `createdById` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `PendingOrder_branchId_status_idx`(`branchId`, `status`),
  INDEX `PendingOrder_branchId_createdAt_idx`(`branchId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PendingOrder`
  ADD CONSTRAINT `PendingOrder_branchId_fkey`
  FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
