-- Supplementary Duty (SD) end-to-end:
-- Bangladesh charges SD on the value before VAT, and VAT is then computed on
-- (value + SD). Store the sale-level SD total and per-line SD rate/amount so
-- receipts, VAT invoices and EFD/Mushak submissions reflect it.

ALTER TABLE `Sale`
  ADD COLUMN `sdAmount` DOUBLE NOT NULL DEFAULT 0;

ALTER TABLE `SaleItem`
  ADD COLUMN `sdRate` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `sdAmount` DOUBLE NOT NULL DEFAULT 0;
