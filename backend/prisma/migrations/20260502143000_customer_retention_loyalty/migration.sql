-- AlterTable
ALTER TABLE `Customer`
  ADD COLUMN `birthDate` DATETIME(3) NULL,
  ADD COLUMN `marketingOptIn` BOOLEAN NOT NULL DEFAULT true;
