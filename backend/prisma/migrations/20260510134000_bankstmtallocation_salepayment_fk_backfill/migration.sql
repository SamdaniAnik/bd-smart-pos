SET @db := DATABASE();
SET @sql := (
  SELECT IF(
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = @db
        AND TABLE_NAME = 'SalePayment'
    ) = 0
    OR (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = @db
        AND TABLE_NAME = 'BankStatementAllocation'
    ) = 0
    OR (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = @db
        AND TABLE_NAME = 'BankStatementAllocation'
        AND CONSTRAINT_NAME = 'BankStatementAllocation_salePaymentId_fkey'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ) > 0,
    'SELECT 1',
    'ALTER TABLE `BankStatementAllocation` ADD CONSTRAINT `BankStatementAllocation_salePaymentId_fkey` FOREIGN KEY (`salePaymentId`) REFERENCES `SalePayment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
