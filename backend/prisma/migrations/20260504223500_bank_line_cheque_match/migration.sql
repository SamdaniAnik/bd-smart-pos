ALTER TABLE `BankStatementLine`
    ADD COLUMN `matchedChequeId` INTEGER NULL;

CREATE UNIQUE INDEX `BankStatementLine_matchedChequeId_key`
    ON `BankStatementLine`(`matchedChequeId`);

ALTER TABLE `BankStatementLine`
    ADD CONSTRAINT `BankStatementLine_matchedChequeId_fkey`
    FOREIGN KEY (`matchedChequeId`) REFERENCES `Cheque`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
