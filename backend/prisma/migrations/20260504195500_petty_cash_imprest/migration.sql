CREATE TABLE `PettyCashFund` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `custodianName` VARCHAR(191) NULL,
    `imprestAmount` DOUBLE NOT NULL DEFAULT 0,
    `currentBalance` DOUBLE NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PettyCashFund_branchId_isActive_idx`(`branchId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PettyCashTxn` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `fundId` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `txnDate` DATETIME(3) NOT NULL,
    `description` VARCHAR(191) NULL,
    `journalId` INTEGER NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PettyCashTxn_branchId_fundId_txnDate_idx`(`branchId`, `fundId`, `txnDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PettyCashFund`
    ADD CONSTRAINT `PettyCashFund_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PettyCashTxn`
    ADD CONSTRAINT `PettyCashTxn_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PettyCashTxn`
    ADD CONSTRAINT `PettyCashTxn_fundId_fkey`
    FOREIGN KEY (`fundId`) REFERENCES `PettyCashFund`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PettyCashTxn`
    ADD CONSTRAINT `PettyCashTxn_journalId_fkey`
    FOREIGN KEY (`journalId`) REFERENCES `Journal`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PettyCashTxn`
    ADD CONSTRAINT `PettyCashTxn_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
