-- MFS payment session persistence, loyalty OTP persistence, SMS templates + delivery logs,
-- pharmacy partial dispense, courier status sync fields.

CREATE TABLE `MfsPaymentSession` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `paymentId` VARCHAR(191) NOT NULL,
  `branchId` INT NOT NULL,
  `method` VARCHAR(32) NOT NULL,
  `provider` VARCHAR(32) NOT NULL,
  `amount` DOUBLE NOT NULL,
  `invoiceRef` VARCHAR(191) NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `merchantNumber` VARCHAR(32) NULL,
  `qrPayload` TEXT NULL,
  `paymentUrl` TEXT NULL,
  `providerPaymentId` VARCHAR(191) NULL,
  `trxId` VARCHAR(64) NULL,
  `simulated` BOOLEAN NOT NULL DEFAULT false,
  `refundTrxId` VARCHAR(64) NULL,
  `refundedAmount` DOUBLE NOT NULL DEFAULT 0,
  `refundedAt` DATETIME(3) NULL,
  `refundReason` TEXT NULL,
  `meta` JSON NULL,
  `verifiedAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `MfsPaymentSession_paymentId_key` (`paymentId`),
  INDEX `MfsPaymentSession_branchId_status_idx` (`branchId`, `status`),
  INDEX `MfsPaymentSession_branchId_createdAt_idx` (`branchId`, `createdAt`),
  CONSTRAINT `MfsPaymentSession_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LoyaltyOtpSession` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branchId` INT NOT NULL,
  `customerId` INT NULL,
  `cardToken` VARCHAR(64) NULL,
  `phone` VARCHAR(20) NOT NULL,
  `otpHash` VARCHAR(128) NOT NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `verified` BOOLEAN NOT NULL DEFAULT false,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `LoyaltyOtpSession_branchId_phone_idx` (`branchId`, `phone`),
  INDEX `LoyaltyOtpSession_expiresAt_idx` (`expiresAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SmsTemplate` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branchId` INT NOT NULL,
  `key` VARCHAR(64) NOT NULL,
  `name` VARCHAR(191) NULL,
  `body` TEXT NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `SmsTemplate_branchId_key_key` (`branchId`, `key`),
  INDEX `SmsTemplate_branchId_idx` (`branchId`),
  CONSTRAINT `SmsTemplate_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SmsDeliveryLog` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branchId` INT NULL,
  `customerId` INT NULL,
  `msisdn` VARCHAR(20) NOT NULL,
  `provider` VARCHAR(32) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `providerMessageId` VARCHAR(191) NULL,
  `segments` INT NOT NULL DEFAULT 1,
  `encoding` VARCHAR(16) NULL,
  `purpose` VARCHAR(64) NULL,
  `errorMessage` TEXT NULL,
  `dlrStatus` VARCHAR(32) NULL,
  `dlrAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `SmsDeliveryLog_providerMessageId_idx` (`providerMessageId`),
  INDEX `SmsDeliveryLog_branchId_createdAt_idx` (`branchId`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PrescriptionLine`
  ADD COLUMN `dispensedQty` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `batchId` INT NULL;

ALTER TABLE `CourierShipment`
  ADD COLUMN `lastSyncedAt` DATETIME(3) NULL,
  ADD COLUMN `deliveredAt` DATETIME(3) NULL;

CREATE INDEX `CourierShipment_trackingId_idx` ON `CourierShipment`(`trackingId`);
