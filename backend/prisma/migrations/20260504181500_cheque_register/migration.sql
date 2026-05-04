-- CreateTable Cheque
CREATE TABLE `Cheque` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `chequeNo` VARCHAR(191) NOT NULL,
    `bankName` VARCHAR(191) NOT NULL,
    `bankBranch` VARCHAR(191) NULL,
    `accountName` VARCHAR(191) NULL,
    `accountNo` VARCHAR(191) NULL,
    `drawerName` VARCHAR(191) NULL,
    `payeeName` VARCHAR(191) NULL,
    `amount` DOUBLE NOT NULL,
    `chequeDate` DATETIME(3) NOT NULL,
    `depositDate` DATETIME(3) NULL,
    `clearedDate` DATETIME(3) NULL,
    `bounceDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `bounceReason` VARCHAR(191) NULL,
    `bounceFee` DOUBLE NOT NULL DEFAULT 0,
    `linkedType` VARCHAR(191) NULL,
    `linkedId` INTEGER NULL,
    `customerId` INTEGER NULL,
    `supplierId` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Cheque_branchId_direction_bankName_chequeNo_key`(`branchId`, `direction`, `bankName`, `chequeNo`),
    INDEX `Cheque_branchId_status_idx`(`branchId`, `status`),
    INDEX `Cheque_branchId_chequeDate_idx`(`branchId`, `chequeDate`),
    INDEX `Cheque_branchId_depositDate_idx`(`branchId`, `depositDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable ChequeEvent
CREATE TABLE `ChequeEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chequeId` INTEGER NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `fromStatus` VARCHAR(191) NULL,
    `toStatus` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `actorId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChequeEvent_chequeId_idx`(`chequeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign keys
ALTER TABLE `Cheque`
    ADD CONSTRAINT `Cheque_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Cheque`
    ADD CONSTRAINT `Cheque_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Cheque`
    ADD CONSTRAINT `Cheque_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Cheque`
    ADD CONSTRAINT `Cheque_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ChequeEvent`
    ADD CONSTRAINT `ChequeEvent_chequeId_fkey`
    FOREIGN KEY (`chequeId`) REFERENCES `Cheque`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ChequeEvent`
    ADD CONSTRAINT `ChequeEvent_actorId_fkey`
    FOREIGN KEY (`actorId`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
