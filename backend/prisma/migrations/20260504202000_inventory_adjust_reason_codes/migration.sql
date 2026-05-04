ALTER TABLE `StockAdjustment`
    ADD COLUMN `reasonCode` VARCHAR(191) NULL,
    ADD COLUMN `journalId` INTEGER NULL;

CREATE TABLE `InventoryAdjustReason` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL DEFAULT 'BOTH',
    `accountingImpact` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `accountCode` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventoryAdjustReason_branchId_code_key`(`branchId`, `code`),
    INDEX `InventoryAdjustReason_branchId_isActive_idx`(`branchId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `StockAdjustment`
    ADD CONSTRAINT `StockAdjustment_journalId_fkey`
    FOREIGN KEY (`journalId`) REFERENCES `Journal`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `InventoryAdjustReason`
    ADD CONSTRAINT `InventoryAdjustReason_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
