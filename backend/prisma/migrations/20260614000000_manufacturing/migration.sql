-- Manufacturing: raw materials, BOM recipes, production orders

ALTER TABLE `Product` ADD COLUMN `isRawMaterial` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Product` ADD COLUMN `isManufactured` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `ManufacturingRecipe` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `finishedProductId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `yieldQty` DOUBLE NOT NULL DEFAULT 1,
    `notes` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ManufacturingRecipe_branchId_finishedProductId_key`(`branchId`, `finishedProductId`),
    INDEX `ManufacturingRecipe_branchId_isActive_idx`(`branchId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ManufacturingRecipeLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recipeId` INTEGER NOT NULL,
    `rawProductId` INTEGER NOT NULL,
    `qtyRequired` DOUBLE NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `ManufacturingRecipeLine_recipeId_idx`(`recipeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductionOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `recipeId` INTEGER NOT NULL,
    `productionNo` VARCHAR(191) NOT NULL,
    `batchCount` DOUBLE NOT NULL DEFAULT 1,
    `finishedQty` DOUBLE NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `consumptionJson` TEXT NULL,
    `notes` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProductionOrder_branchId_productionNo_key`(`branchId`, `productionNo`),
    INDEX `ProductionOrder_branchId_createdAt_idx`(`branchId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ManufacturingRecipe` ADD CONSTRAINT `ManufacturingRecipe_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ManufacturingRecipe` ADD CONSTRAINT `ManufacturingRecipe_finishedProductId_fkey` FOREIGN KEY (`finishedProductId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ManufacturingRecipeLine` ADD CONSTRAINT `ManufacturingRecipeLine_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `ManufacturingRecipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ManufacturingRecipeLine` ADD CONSTRAINT `ManufacturingRecipeLine_rawProductId_fkey` FOREIGN KEY (`rawProductId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductionOrder` ADD CONSTRAINT `ProductionOrder_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ProductionOrder` ADD CONSTRAINT `ProductionOrder_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `ManufacturingRecipe`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
