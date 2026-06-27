-- Phase 4 · New verticals: restaurant KOT, IMEI/serial, storefront inbound, touch/PWA prep

ALTER TABLE `Product`
    ADD COLUMN `trackSerial` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `warrantyDays` INTEGER NULL;

ALTER TABLE `SaleItem`
    ADD COLUMN `serialNumber` VARCHAR(191) NULL,
    ADD COLUMN `warrantyUntil` DATETIME(3) NULL;

ALTER TABLE `Branch` ADD COLUMN `storefrontToken` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Branch_storefrontToken_key` ON `Branch`(`storefrontToken`);

CREATE TABLE `RestaurantTable` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `capacity` INTEGER NOT NULL DEFAULT 4,
    `status` VARCHAR(191) NOT NULL DEFAULT 'FREE',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RestaurantTable_branchId_code_key`(`branchId`, `code`),
    INDEX `RestaurantTable_branchId_status_idx`(`branchId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestaurantTable` ADD CONSTRAINT `RestaurantTable_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `KitchenTicket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `tableId` INTEGER NULL,
    `ticketNo` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `itemsJson` MEDIUMTEXT NOT NULL,
    `notes` VARCHAR(191) NULL,
    `saleId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KitchenTicket_branchId_status_idx`(`branchId`, `status`),
    INDEX `KitchenTicket_branchId_createdAt_idx`(`branchId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `KitchenTicket` ADD CONSTRAINT `KitchenTicket_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `KitchenTicket` ADD CONSTRAINT `KitchenTicket_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `RestaurantTable`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
