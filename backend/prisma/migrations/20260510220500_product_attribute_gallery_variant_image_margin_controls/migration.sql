-- Product dynamic attributes and gallery
ALTER TABLE `Product`
  ADD COLUMN `attributeValues` JSON NULL,
  ADD COLUMN `imageGallery` JSON NULL;

-- Variant-level image
ALTER TABLE `ProductVariant`
  ADD COLUMN `imageUrl` VARCHAR(500) NULL;

-- Barcode aliases can target a specific variant (SKU)
ALTER TABLE `ProductBarcode`
  ADD COLUMN `productVariantId` INTEGER NULL;

ALTER TABLE `ProductBarcode`
  ADD CONSTRAINT `ProductBarcode_productVariantId_fkey`
  FOREIGN KEY (`productVariantId`) REFERENCES `ProductVariant`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `ProductBarcode_branchId_productVariantId_idx`
  ON `ProductBarcode`(`branchId`, `productVariantId`);

-- Category-level attribute set and margin controls
ALTER TABLE `ProductCategory`
  ADD COLUMN `attributeSet` JSON NULL,
  ADD COLUMN `minMarginPct` DOUBLE NULL;
