ALTER TABLE `BankStatementImport`
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `closedById` INTEGER NULL,
    ADD COLUMN `closingNote` VARCHAR(191) NULL;

ALTER TABLE `BankStatementImport`
    ADD CONSTRAINT `BankStatementImport_closedById_fkey`
    FOREIGN KEY (`closedById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
