-- Inventory batch tables (required before pharmacy_batches_prescriptions alters InventoryBatch).

CREATE TABLE `InventoryBatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `batchCode` VARCHAR(191) NOT NULL,
    `expiryDate` DATETIME(3) NULL,
    `qtyOnHand` INTEGER NOT NULL DEFAULT 0,
    `unitCost` DOUBLE NOT NULL DEFAULT 0,
    `legacyAuditLogId` INTEGER NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventoryBatch_branchId_productId_batchCode_key`(`branchId`, `productId`, `batchCode`),
    INDEX `InventoryBatch_branchId_productId_idx`(`branchId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `InventoryBatch` ADD CONSTRAINT `InventoryBatch_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `InventoryBatch` ADD CONSTRAINT `InventoryBatch_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `SaleItemBatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleItemId` INTEGER NOT NULL,
    `batchId` INTEGER NOT NULL,
    `qty` INTEGER NOT NULL,

    INDEX `SaleItemBatch_saleItemId_idx`(`saleItemId`),
    INDEX `SaleItemBatch_batchId_idx`(`batchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SaleItemBatch` ADD CONSTRAINT `SaleItemBatch_saleItemId_fkey`
    FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SaleItemBatch` ADD CONSTRAINT `SaleItemBatch_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `InventoryBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
