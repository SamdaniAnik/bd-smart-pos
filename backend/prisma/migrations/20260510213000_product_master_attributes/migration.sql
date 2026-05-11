-- Add product master attributes for richer catalog data.
ALTER TABLE `Product`
  ADD COLUMN `size` VARCHAR(191) NULL,
  ADD COLUMN `color` VARCHAR(191) NULL,
  ADD COLUMN `brand` VARCHAR(191) NULL,
  ADD COLUMN `model` VARCHAR(191) NULL,
  ADD COLUMN `specification` TEXT NULL;
