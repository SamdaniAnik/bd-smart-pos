ALTER TABLE `BankStatementLine`
    ADD COLUMN `exceptionStatus` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    ADD COLUMN `exceptionReason` VARCHAR(191) NULL,
    ADD COLUMN `exceptionNote` VARCHAR(191) NULL,
    ADD COLUMN `exceptionRaisedAt` DATETIME(3) NULL,
    ADD COLUMN `exceptionResolvedAt` DATETIME(3) NULL,
    ADD COLUMN `exceptionResolvedById` INTEGER NULL;

ALTER TABLE `BankStatementLine`
    ADD CONSTRAINT `BankStatementLine_exceptionResolvedById_fkey`
    FOREIGN KEY (`exceptionResolvedById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
