SET @db := DATABASE();
SET @sql := (
  SELECT IF(
    (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = @db
        AND TABLE_NAME = 'Branch'
    ) = 0
    OR (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = @db
        AND TABLE_NAME = 'PromotionRule'
    ) = 0
    OR (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = @db
        AND TABLE_NAME = 'PromotionRule'
        AND CONSTRAINT_NAME = 'PromotionRule_branchId_fkey'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ) > 0,
    'SELECT 1',
    'ALTER TABLE `PromotionRule` ADD CONSTRAINT `PromotionRule_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE'
  )
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
