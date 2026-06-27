-- Near-expiry auto-markdown tiers.
-- Per-branch JSON config: { enabled, tiers: [{ days, percent }] }. Products with
-- batch expiry within a tier window are auto-marked-down by that tier's percent.

ALTER TABLE `Branch`
  ADD COLUMN `expiryMarkdownJson` TEXT NULL;
