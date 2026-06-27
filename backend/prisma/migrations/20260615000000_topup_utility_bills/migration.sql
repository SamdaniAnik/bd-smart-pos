-- Recharge / Flexiload + Utility Bill Pay: topup float on branch + service ledger

ALTER TABLE `Branch` ADD COLUMN `topupFloatBalance` DOUBLE NOT NULL DEFAULT 0;

CREATE TABLE `UtilityTransaction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `operatorOrBiller` VARCHAR(191) NOT NULL,
    `accountOrMsisdn` VARCHAR(191) NOT NULL,
    `faceAmount` DOUBLE NOT NULL DEFAULT 0,
    `serviceCharge` DOUBLE NOT NULL DEFAULT 0,
    `commission` DOUBLE NOT NULL DEFAULT 0,
    `payMethod` VARCHAR(191) NOT NULL DEFAULT 'Cash',
    `payChannel` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'SUCCESS',
    `providerRef` VARCHAR(191) NULL,
    `token` VARCHAR(191) NULL,
    `customerId` INTEGER NULL,
    `shiftId` INTEGER NULL,
    `createdBy` INTEGER NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UtilityTransaction_branchId_createdAt_idx`(`branchId`, `createdAt`),
    INDEX `UtilityTransaction_type_status_idx`(`type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UtilityTransaction` ADD CONSTRAINT `UtilityTransaction_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
