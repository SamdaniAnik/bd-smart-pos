-- CreateTable
CREATE TABLE `PromotionRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `productId` INTEGER NULL,
    `category` VARCHAR(191) NULL,
    `buyQty` INTEGER NOT NULL DEFAULT 1,
    `getQty` INTEGER NOT NULL DEFAULT 1,
    `discountValue` DOUBLE NOT NULL DEFAULT 0,
    `minBasketAmount` DOUBLE NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PromotionRule_branchId_isActive_idx`(`branchId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey (guarded because `Branch` table is introduced in a later migration)
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

-- AddForeignKey
ALTER TABLE `PromotionRule` ADD CONSTRAINT `PromotionRule_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
