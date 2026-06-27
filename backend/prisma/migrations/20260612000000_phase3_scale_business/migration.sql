-- Phase 3 · Scale the business: org/subscription, owner digest, courier/COD

CREATE TABLE `Organization` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `planCode` VARCHAR(191) NOT NULL DEFAULT 'trial',
    `subscriptionStatus` VARCHAR(191) NOT NULL DEFAULT 'TRIAL',
    `trialEndsAt` DATETIME(3) NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `billingEmail` VARCHAR(191) NULL,
    `bdtMonthlyFee` DOUBLE NOT NULL DEFAULT 1500,
    `maxBranches` INTEGER NOT NULL DEFAULT 5,
    `maxUsers` INTEGER NOT NULL DEFAULT 15,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Organization_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `Organization` (`code`, `name`, `planCode`, `subscriptionStatus`, `trialEndsAt`, `bdtMonthlyFee`, `maxBranches`, `maxUsers`, `updatedAt`)
VALUES ('default', 'Default Organization', 'trial', 'TRIAL', DATE_ADD(NOW(3), INTERVAL 30 DAY), 1500, 5, 15, NOW(3));

ALTER TABLE `Branch`
    ADD COLUMN `organizationId` INTEGER NULL,
    ADD COLUMN `ownerPhone` VARCHAR(191) NULL,
    ADD COLUMN `digestEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `digestHour` INTEGER NOT NULL DEFAULT 21,
    ADD COLUMN `courierProvider` VARCHAR(191) NULL,
    ADD COLUMN `courierApiKey` TEXT NULL,
    ADD COLUMN `courierStoreId` VARCHAR(191) NULL;

UPDATE `Branch` SET `organizationId` = 1 WHERE `organizationId` IS NULL;

ALTER TABLE `Branch` ADD CONSTRAINT `Branch_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `CourierShipment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `saleId` INTEGER NULL,
    `pendingOrderId` INTEGER NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `status` VARCHAR(191) NOT NULL DEFAULT 'CREATED',
    `trackingId` VARCHAR(191) NULL,
    `codAmount` DOUBLE NOT NULL DEFAULT 0,
    `codCollectedAt` DATETIME(3) NULL,
    `recipientName` VARCHAR(191) NULL,
    `recipientPhone` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CourierShipment_branchId_status_idx`(`branchId`, `status`),
    INDEX `CourierShipment_branchId_createdAt_idx`(`branchId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CourierShipment` ADD CONSTRAINT `CourierShipment_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Sale`
    ADD COLUMN `codStatus` VARCHAR(191) NULL,
    ADD COLUMN `codExpectedAmount` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `codCollectedAt` DATETIME(3) NULL;
