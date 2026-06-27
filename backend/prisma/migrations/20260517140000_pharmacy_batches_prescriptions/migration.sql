-- Pharmacy: variant batches, purchase receiving, prescriptions

ALTER TABLE `InventoryBatch` ADD COLUMN `productVariantId` INT NULL;
ALTER TABLE `InventoryBatch` DROP INDEX `InventoryBatch_branchId_productId_batchCode_key`;
CREATE UNIQUE INDEX `InventoryBatch_branch_product_variant_batch_key`
  ON `InventoryBatch`(`branchId`, `productId`, `productVariantId`, `batchCode`);

ALTER TABLE `PurchaseItem` ADD COLUMN `productVariantId` INT NULL;
ALTER TABLE `PurchaseItem` ADD COLUMN `batchCode` VARCHAR(191) NULL;
ALTER TABLE `PurchaseItem` ADD COLUMN `expiryDate` DATETIME(3) NULL;

ALTER TABLE `Sale` ADD COLUMN `prescriptionId` INT NULL;

CREATE TABLE `Prescription` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `branchId` INT NOT NULL,
  `prescriptionNo` VARCHAR(64) NULL,
  `patientName` VARCHAR(191) NOT NULL,
  `patientPhone` VARCHAR(64) NULL,
  `doctorName` VARCHAR(191) NULL,
  `notes` VARCHAR(2000) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  `customerId` INT NULL,
  `saleId` INT NULL,
  `createdById` INT NULL,
  `dispensedById` INT NULL,
  `dispensedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `Prescription_branchId_status_idx`(`branchId`, `status`),
  INDEX `Prescription_branchId_prescriptionNo_idx`(`branchId`, `prescriptionNo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PrescriptionLine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `prescriptionId` INT NOT NULL,
  `productId` INT NOT NULL,
  `productVariantId` INT NULL,
  `qty` DOUBLE NOT NULL DEFAULT 1,
  `dosageNote` VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  INDEX `PrescriptionLine_prescriptionId_idx`(`prescriptionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Prescription` ADD CONSTRAINT `Prescription_branchId_fkey`
  FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PrescriptionLine` ADD CONSTRAINT `PrescriptionLine_prescriptionId_fkey`
  FOREIGN KEY (`prescriptionId`) REFERENCES `Prescription`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `Permission` (`code`, `description`)
SELECT 'pharmacy.view', 'View prescriptions'
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'pharmacy.view');

INSERT INTO `Permission` (`code`, `description`)
SELECT 'pharmacy.manage', 'Create and edit prescriptions'
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'pharmacy.manage');

INSERT INTO `Permission` (`code`, `description`)
SELECT 'pharmacy.dispense', 'Dispense prescriptions at POS'
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'pharmacy.dispense');

INSERT INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.id, p.id FROM `Role` r
CROSS JOIN `Permission` p
WHERE r.name = 'Admin' AND p.code IN ('pharmacy.view', 'pharmacy.manage', 'pharmacy.dispense')
AND NOT EXISTS (
  SELECT 1 FROM `RolePermission` rp WHERE rp.roleId = r.id AND rp.permissionId = p.id
);
