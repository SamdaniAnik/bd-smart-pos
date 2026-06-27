-- Retail store profile: super shop + pharmacy + apparel
ALTER TABLE `Branch` ADD COLUMN `businessProfile` VARCHAR(32) NOT NULL DEFAULT 'MIXED';
ALTER TABLE `ProductCategory` ADD COLUMN `department` VARCHAR(32) NULL;
