SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS `PaymentSettlement` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `branchId` INTEGER NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `periodStart` DATETIME(3) NOT NULL,
  `periodEnd` DATETIME(3) NOT NULL,
  `grossAmount` DOUBLE NOT NULL,
  `feeAmount` DOUBLE NOT NULL DEFAULT 0,
  `netAmount` DOUBLE NOT NULL,
  `externalRef` VARCHAR(191) NULL,
  `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `meta` JSON NULL,
  INDEX `PaymentSettlement_branchId_idx`(`branchId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `SalePayment` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `saleId` INTEGER NOT NULL,
  `method` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(191) NULL,
  `amount` DOUBLE NOT NULL,
  `meta` JSON NULL,
  `reconciledAt` DATETIME(3) NULL,
  `settlementId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `SalePayment_saleId_idx`(`saleId`),
  INDEX `SalePayment_method_reconciledAt_idx`(`method`, `reconciledAt`),
  INDEX `SalePayment_channel_idx`(`channel`),
  INDEX `SalePayment_settlementId_idx`(`settlementId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'PaymentSettlement' AND CONSTRAINT_NAME = 'PaymentSettlement_branchId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE `PaymentSettlement` ADD CONSTRAINT `PaymentSettlement_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'SalePayment' AND CONSTRAINT_NAME = 'SalePayment_saleId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE `SalePayment` ADD CONSTRAINT `SalePayment_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE CASCADE ON UPDATE CASCADE'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'SalePayment' AND CONSTRAINT_NAME = 'SalePayment_settlementId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE `SalePayment` ADD CONSTRAINT `SalePayment_settlementId_fkey` FOREIGN KEY (`settlementId`) REFERENCES `PaymentSettlement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
