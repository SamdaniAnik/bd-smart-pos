-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS `WebhookDeliveryLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branchId` INTEGER NOT NULL,
    `webhookSubscriptionId` INTEGER NULL,
    `event` VARCHAR(160) NOT NULL,
    `url` TEXT NOT NULL,
    `ok` BOOLEAN NOT NULL DEFAULT false,
    `statusCode` INTEGER NULL,
    `errorMessage` TEXT NULL,
    `durationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WebhookDeliveryLog_branchId_createdAt_idx`(`branchId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SET @sql := (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'WebhookDeliveryLog' AND CONSTRAINT_NAME = 'WebhookDeliveryLog_branchId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0, 'SELECT 1', 'ALTER TABLE `WebhookDeliveryLog` ADD CONSTRAINT `WebhookDeliveryLog_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'WebhookDeliveryLog' AND CONSTRAINT_NAME = 'WebhookDeliveryLog_webhookSubscriptionId_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0, 'SELECT 1', 'ALTER TABLE `WebhookDeliveryLog` ADD CONSTRAINT `WebhookDeliveryLog_webhookSubscriptionId_fkey` FOREIGN KEY (`webhookSubscriptionId`) REFERENCES `WebhookSubscription`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
