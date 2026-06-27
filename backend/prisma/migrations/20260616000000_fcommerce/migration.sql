-- F-commerce: WhatsApp Business + Facebook Messenger → OrderInbox

ALTER TABLE `Branch` ADD COLUMN `fcommerceConfigJson` MEDIUMTEXT NULL;

ALTER TABLE `PendingOrder`
    ADD COLUMN `externalPlatform` VARCHAR(191) NULL,
    ADD COLUMN `externalSenderId` VARCHAR(191) NULL,
    ADD COLUMN `externalMessageId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `PendingOrder_branchId_externalMessageId_key` ON `PendingOrder`(`branchId`, `externalMessageId`);
CREATE INDEX `PendingOrder_externalSenderId_idx` ON `PendingOrder`(`externalSenderId`);
