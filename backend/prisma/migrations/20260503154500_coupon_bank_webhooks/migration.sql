-- AlterTable
ALTER TABLE `Sale` ADD COLUMN `couponCodeId` INTEGER NULL,
    ADD COLUMN `couponDiscount` DOUBLE NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `CouponCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `discountType` VARCHAR(191) NOT NULL DEFAULT 'PERCENT',
    `discountValue` DOUBLE NOT NULL,
    `minBasketAmount` DOUBLE NOT NULL DEFAULT 0,
    `maxRedemptions` INTEGER NOT NULL DEFAULT 0,
    `redemptionCount` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CouponCode_branchId_code_key`(`branchId`, `code`),
    INDEX `CouponCode_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankStatementImport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `label` VARCHAR(191) NULL,
    `rowCount` INTEGER NOT NULL DEFAULT 0,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `meta` JSON NULL,

    INDEX `BankStatementImport_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankStatementLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `importId` INTEGER NOT NULL,
    `txnDate` DATETIME(3) NOT NULL,
    `description` VARCHAR(191) NULL,
    `amount` DOUBLE NOT NULL,
    `direction` VARCHAR(191) NOT NULL DEFAULT 'CREDIT',
    `reference` VARCHAR(191) NULL,
    `matchedSalePaymentId` INTEGER NULL,
    `matchedAt` DATETIME(3) NULL,
    `matchNote` VARCHAR(191) NULL,

    UNIQUE INDEX `BankStatementLine_matchedSalePaymentId_key`(`matchedSalePaymentId`),
    INDEX `BankStatementLine_importId_idx`(`importId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookSubscription` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `url` TEXT NOT NULL,
    `secret` VARCHAR(191) NOT NULL DEFAULT '',
    `events` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WebhookSubscription_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CouponCode` ADD CONSTRAINT `CouponCode_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_couponCodeId_fkey` FOREIGN KEY (`couponCodeId`) REFERENCES `CouponCode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankStatementImport` ADD CONSTRAINT `BankStatementImport_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankStatementLine` ADD CONSTRAINT `BankStatementLine_importId_fkey` FOREIGN KEY (`importId`) REFERENCES `BankStatementImport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (guarded for environments where SalePayment is introduced later)
SET @db := DATABASE();
SET @sql := (
  SELECT IF(
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = @db
        AND TABLE_NAME = 'SalePayment'
    ) = 0
    OR (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = @db
        AND TABLE_NAME = 'BankStatementLine'
        AND CONSTRAINT_NAME = 'BankStatementLine_matchedSalePaymentId_fkey'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ) > 0,
    'SELECT 1',
    'ALTER TABLE `BankStatementLine` ADD CONSTRAINT `BankStatementLine_matchedSalePaymentId_fkey` FOREIGN KEY (`matchedSalePaymentId`) REFERENCES `SalePayment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- AddForeignKey
ALTER TABLE `WebhookSubscription` ADD CONSTRAINT `WebhookSubscription_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
