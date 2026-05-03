-- AlterTable Product
ALTER TABLE `Product`
    ADD COLUMN `sellByWeight` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `stockKg` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `hasVariants` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `ProductVariant` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `label` VARCHAR(191) NOT NULL DEFAULT '',
    `sku` VARCHAR(191) NULL,
    `barcode` VARCHAR(191) NULL,
    `stock` INTEGER NOT NULL DEFAULT 0,
    `priceOverride` DOUBLE NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductVariant_branchId_barcode_key`(`branchId`, `barcode`),
    INDEX `ProductVariant_branchId_productId_idx`(`branchId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable StockLedger (weight audit)
ALTER TABLE `StockLedger`
    ADD COLUMN `outWeightKg` DOUBLE NULL,
    ADD COLUMN `inWeightKg` DOUBLE NULL;

-- AlterTable SaleItem: price line fields
ALTER TABLE `SaleItem`
    ADD COLUMN `productVariantId` INTEGER NULL,
    ADD COLUMN `weightKg` DOUBLE NULL,
    MODIFY COLUMN `qty` DOUBLE NOT NULL;

ALTER TABLE `ProductVariant`
    ADD CONSTRAINT `ProductVariant_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductVariant`
    ADD CONSTRAINT `ProductVariant_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SaleItem`
    ADD CONSTRAINT `SaleItem_productVariantId_fkey`
    FOREIGN KEY (`productVariantId`) REFERENCES `ProductVariant`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
