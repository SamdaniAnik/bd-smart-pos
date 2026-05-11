CREATE TABLE `ProductBarcode` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `branchId` INTEGER NOT NULL,
  `productId` INTEGER NOT NULL,
  `barcode` VARCHAR(191) NOT NULL,
  `note` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ProductBarcode_branchId_barcode_key`(`branchId`, `barcode`),
  INDEX `ProductBarcode_branchId_productId_idx`(`branchId`, `productId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductBarcode`
  ADD CONSTRAINT `ProductBarcode_branchId_fkey`
  FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductBarcode`
  ADD CONSTRAINT `ProductBarcode_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `Product`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
