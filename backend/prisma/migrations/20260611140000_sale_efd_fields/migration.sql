-- EFD / fiscal device fields on Sale
ALTER TABLE `Sale`
  ADD COLUMN `efdFiscalInvoiceNo` VARCHAR(64) NULL,
  ADD COLUMN `efdQrPayload` TEXT NULL,
  ADD COLUMN `efdVerificationUrl` VARCHAR(512) NULL,
  ADD COLUMN `efdSubmittedAt` DATETIME(3) NULL,
  ADD COLUMN `efdProvider` VARCHAR(32) NULL;
