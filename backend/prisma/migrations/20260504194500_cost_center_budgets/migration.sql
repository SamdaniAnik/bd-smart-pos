CREATE TABLE `CostCenterBudget` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `costCenterId` INTEGER NOT NULL,
    `periodKey` VARCHAR(191) NOT NULL,
    `expenseBudget` DOUBLE NOT NULL DEFAULT 0,
    `revenueBudget` DOUBLE NOT NULL DEFAULT 0,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CostCenterBudget_costCenterId_periodKey_key`(`costCenterId`, `periodKey`),
    INDEX `CostCenterBudget_branchId_periodKey_idx`(`branchId`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CostCenterBudget`
    ADD CONSTRAINT `CostCenterBudget_costCenterId_fkey`
    FOREIGN KEY (`costCenterId`) REFERENCES `CostCenter`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
