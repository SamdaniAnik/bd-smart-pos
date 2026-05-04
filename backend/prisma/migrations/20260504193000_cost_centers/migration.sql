-- CreateTable CostCenter
CREATE TABLE `CostCenter` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CostCenter_branchId_code_key`(`branchId`, `code`),
    INDEX `CostCenter_branchId_isActive_idx`(`branchId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Alter tables for optional cost center tags
ALTER TABLE `Journal` ADD COLUMN `costCenterId` INTEGER NULL;
ALTER TABLE `Expense` ADD COLUMN `costCenterId` INTEGER NULL;

ALTER TABLE `CostCenter`
    ADD CONSTRAINT `CostCenter_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Journal`
    ADD CONSTRAINT `Journal_costCenterId_fkey`
    FOREIGN KEY (`costCenterId`) REFERENCES `CostCenter`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Expense`
    ADD CONSTRAINT `Expense_costCenterId_fkey`
    FOREIGN KEY (`costCenterId`) REFERENCES `CostCenter`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
