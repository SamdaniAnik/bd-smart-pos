CREATE TABLE `BankStatementAllocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `lineId` INTEGER NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `salePaymentId` INTEGER NULL,
    `chequeId` INTEGER NULL,
    `amount` DOUBLE NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `BankStatementAllocation_branchId_lineId_idx`(`branchId`, `lineId`),
    INDEX `BankStatementAllocation_branchId_targetType_idx`(`branchId`, `targetType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BankStatementAllocation`
    ADD CONSTRAINT `BankStatementAllocation_lineId_fkey`
    FOREIGN KEY (`lineId`) REFERENCES `BankStatementLine`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `BankStatementAllocation`
    ADD CONSTRAINT `BankStatementAllocation_salePaymentId_fkey`
    FOREIGN KEY (`salePaymentId`) REFERENCES `SalePayment`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `BankStatementAllocation`
    ADD CONSTRAINT `BankStatementAllocation_chequeId_fkey`
    FOREIGN KEY (`chequeId`) REFERENCES `Cheque`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `BankStatementAllocation`
    ADD CONSTRAINT `BankStatementAllocation_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
