-- Product master enhancement: barcode + image URL.
ALTER TABLE `Product`
  ADD COLUMN `barcode` VARCHAR(191) NULL,
  ADD COLUMN `imageUrl` VARCHAR(500) NULL;

CREATE UNIQUE INDEX `Product_branchId_barcode_key` ON `Product`(`branchId`, `barcode`);
