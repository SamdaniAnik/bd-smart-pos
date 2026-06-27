-- Bakir Khata ledger, KYC fields, warranty claims, loyalty card tokens
ALTER TABLE `Customer`
  ADD COLUMN `nidNumber` VARCHAR(20) NULL,
  ADD COLUMN `birthCertificateNo` VARCHAR(40) NULL,
  ADD COLUMN `kycDocumentType` VARCHAR(20) NULL,
  ADD COLUMN `kycCapturedAt` DATETIME(3) NULL,
  ADD COLUMN `loyaltyCardToken` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `Customer_loyaltyCardToken_key` ON `Customer`(`loyaltyCardToken`);

ALTER TABLE `Product`
  ADD COLUMN `requiresKyc` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `CustomerCreditLedger` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branchId` INT NOT NULL,
  `customerId` INT NOT NULL,
  `entryType` VARCHAR(32) NOT NULL,
  `amount` DOUBLE NOT NULL,
  `balanceAfter` DOUBLE NOT NULL,
  `saleId` INT NULL,
  `receiptVoucherId` INT NULL,
  `note` TEXT NULL,
  `createdById` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `CustomerCreditLedger_branchId_customerId_createdAt_idx` (`branchId`, `customerId`, `createdAt`),
  CONSTRAINT `CustomerCreditLedger_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CustomerCreditLedger_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WarrantyClaim` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branchId` INT NOT NULL,
  `claimNo` VARCHAR(32) NULL,
  `saleItemId` INT NULL,
  `serialNumber` VARCHAR(64) NOT NULL,
  `customerId` INT NULL,
  `productId` INT NULL,
  `saleId` INT NULL,
  `invoiceNo` VARCHAR(64) NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  `issue` TEXT NOT NULL,
  `resolution` TEXT NULL,
  `warrantyUntil` DATETIME(3) NULL,
  `createdById` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `WarrantyClaim_branchId_status_idx` (`branchId`, `status`),
  INDEX `WarrantyClaim_branchId_serialNumber_idx` (`branchId`, `serialNumber`),
  CONSTRAINT `WarrantyClaim_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
