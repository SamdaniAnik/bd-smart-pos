-- Add bootstrap flag to Branch so /api/bootstrap/seed can short-circuit on subsequent calls.
-- Idempotent: skip ADD COLUMN if the column already exists (recovers from partial / duplicate deploys).

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'Branch' AND COLUMN_NAME = 'bootstrapped') > 0,
    'SELECT 1 AS bootstrap_col_ok',
    'ALTER TABLE `Branch` ADD COLUMN `bootstrapped` BOOLEAN NOT NULL DEFAULT false'
  )
);
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'Branch' AND COLUMN_NAME = 'bootstrappedAt') > 0,
    'SELECT 1 AS bootstrap_at_ok',
    'ALTER TABLE `Branch` ADD COLUMN `bootstrappedAt` DATETIME(3) NULL'
  )
);
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;

-- Treat any branch that already has at least one User+Account+Role binding as bootstrapped,
-- so existing installations keep working without re-running seed.
UPDATE `Branch` b
SET b.`bootstrapped` = true,
    b.`bootstrappedAt` = b.`createdAt`
WHERE EXISTS (
    SELECT 1 FROM `Account` a WHERE a.`branchId` = b.`id` AND a.`isSystem` = true
);
