-- Branch-wide business type (retail / pharmacy / grocery / ecommerce / restaurant).
-- Drives the device UI defaults (theme, menu, terminology, landing page) that
-- cannot be expressed through the existing businessProfile column.
ALTER TABLE `Branch`
  ADD COLUMN `businessType` VARCHAR(32) NULL;
