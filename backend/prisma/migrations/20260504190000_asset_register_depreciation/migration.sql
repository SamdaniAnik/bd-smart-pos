-- CreateTable Asset
CREATE TABLE `Asset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `assetCode` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NULL,
    `purchaseDate` DATETIME(3) NOT NULL,
    `inServiceDate` DATETIME(3) NOT NULL,
    `cost` DOUBLE NOT NULL,
    `salvageValue` DOUBLE NOT NULL DEFAULT 0,
    `usefulLifeMonths` INTEGER NOT NULL,
    `depreciationMethod` VARCHAR(191) NOT NULL DEFAULT 'STRAIGHT_LINE',
    `accumulatedDepreciation` DOUBLE NOT NULL DEFAULT 0,
    `lastDepreciationDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `disposedAt` DATETIME(3) NULL,
    `disposalValue` DOUBLE NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Asset_branchId_status_idx`(`branchId`, `status`),
    UNIQUE INDEX `Asset_branchId_assetCode_key`(`branchId`, `assetCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable AssetDepreciationEntry
CREATE TABLE `AssetDepreciationEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `assetId` INTEGER NOT NULL,
    `periodKey` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `runDate` DATETIME(3) NOT NULL,
    `journalId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AssetDepreciationEntry_assetId_periodKey_key`(`assetId`, `periodKey`),
    INDEX `AssetDepreciationEntry_branchId_periodKey_idx`(`branchId`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Asset`
    ADD CONSTRAINT `Asset_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `AssetDepreciationEntry`
    ADD CONSTRAINT `AssetDepreciationEntry_assetId_fkey`
    FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AssetDepreciationEntry`
    ADD CONSTRAINT `AssetDepreciationEntry_journalId_fkey`
    FOREIGN KEY (`journalId`) REFERENCES `Journal`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
