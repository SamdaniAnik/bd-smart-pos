-- Retail sale units: pharmacy (tablet/pack/strip), apparel (pcs/set), grocery (gm/half kg/kg)

ALTER TABLE `Product`
  ADD COLUMN `saleUnit` VARCHAR(16) NULL,
  ADD COLUMN `allowedSaleUnits` JSON NULL;

ALTER TABLE `SaleItem`
  ADD COLUMN `saleUnit` VARCHAR(16) NULL;

-- Backfill sale unit from unitOfMeasure / sell-by-weight
UPDATE `Product`
SET `saleUnit` = CASE
  WHEN `sellByWeight` = 1 THEN COALESCE(NULLIF(TRIM(`unitOfMeasure`), ''), 'KG')
  ELSE COALESCE(NULLIF(TRIM(`unitOfMeasure`), ''), 'PCS')
END
WHERE `saleUnit` IS NULL;
