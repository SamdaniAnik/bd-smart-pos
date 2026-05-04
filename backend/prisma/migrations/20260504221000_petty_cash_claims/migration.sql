CREATE TABLE `PettyCashClaim` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `fundId` INTEGER NOT NULL,
    `txnId` INTEGER NULL,
    `amount` DOUBLE NOT NULL,
    `claimDate` DATETIME(3) NOT NULL,
    `description` VARCHAR(191) NULL,
    `attachmentNote` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdById` INTEGER NULL,
    `reviewedById` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewRemark` VARCHAR(191) NULL,
    `journalId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PettyCashClaim_branchId_status_claimDate_idx`(`branchId`, `status`, `claimDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PettyCashClaim`
    ADD CONSTRAINT `PettyCashClaim_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PettyCashClaim`
    ADD CONSTRAINT `PettyCashClaim_fundId_fkey`
    FOREIGN KEY (`fundId`) REFERENCES `PettyCashFund`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PettyCashClaim`
    ADD CONSTRAINT `PettyCashClaim_txnId_fkey`
    FOREIGN KEY (`txnId`) REFERENCES `PettyCashTxn`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PettyCashClaim`
    ADD CONSTRAINT `PettyCashClaim_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PettyCashClaim`
    ADD CONSTRAINT `PettyCashClaim_reviewedById_fkey`
    FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PettyCashClaim`
    ADD CONSTRAINT `PettyCashClaim_journalId_fkey`
    FOREIGN KEY (`journalId`) REFERENCES `Journal`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
