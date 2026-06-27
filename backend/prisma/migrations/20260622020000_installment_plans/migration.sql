-- Installment / কিস্তি (hire-purchase) sales.
-- A plan finances (principal - down payment) over N installments at an optional
-- flat interest rate, with a generated due schedule used for collection + SMS reminders.

CREATE TABLE `InstallmentPlan` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branchId` INT NOT NULL,
  `customerId` INT NOT NULL,
  `saleId` INT NULL,
  `reference` VARCHAR(191) NULL,
  `principalAmount` DOUBLE NOT NULL DEFAULT 0,
  `downPayment` DOUBLE NOT NULL DEFAULT 0,
  `financedAmount` DOUBLE NOT NULL DEFAULT 0,
  `interestRate` DOUBLE NOT NULL DEFAULT 0,
  `interestAmount` DOUBLE NOT NULL DEFAULT 0,
  `totalPayable` DOUBLE NOT NULL DEFAULT 0,
  `installmentCount` INT NOT NULL DEFAULT 1,
  `installmentAmount` DOUBLE NOT NULL DEFAULT 0,
  `frequency` VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
  `startDate` DATETIME(3) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  `note` VARCHAR(191) NULL,
  `createdById` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `InstallmentPlan_branchId_status_idx` (`branchId`, `status`),
  INDEX `InstallmentPlan_branchId_customerId_idx` (`branchId`, `customerId`),
  CONSTRAINT `InstallmentPlan_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InstallmentPayment` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branchId` INT NOT NULL,
  `planId` INT NOT NULL,
  `seqNo` INT NOT NULL,
  `dueDate` DATETIME(3) NOT NULL,
  `amountDue` DOUBLE NOT NULL DEFAULT 0,
  `amountPaid` DOUBLE NOT NULL DEFAULT 0,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `paidAt` DATETIME(3) NULL,
  `receiptVoucherId` INT NULL,
  `note` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `InstallmentPayment_branchId_status_dueDate_idx` (`branchId`, `status`, `dueDate`),
  INDEX `InstallmentPayment_planId_seqNo_idx` (`planId`, `seqNo`),
  CONSTRAINT `InstallmentPayment_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `InstallmentPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
