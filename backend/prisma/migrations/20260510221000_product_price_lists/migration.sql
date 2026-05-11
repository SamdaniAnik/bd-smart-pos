CREATE TABLE `ProductPriceList` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `branchId` INTEGER NOT NULL,
  `productId` INTEGER NOT NULL,
  `priceType` VARCHAR(32) NOT NULL,
  `amount` DOUBLE NOT NULL,
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `note` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ProductPriceList_branchId_productId_priceType_effectiveFrom_idx`(`branchId`, `productId`, `priceType`, `effectiveFrom`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductPriceList`
  ADD CONSTRAINT `ProductPriceList_branchId_fkey`
  FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductPriceList`
  ADD CONSTRAINT `ProductPriceList_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `Product`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
