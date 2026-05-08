-- Bank Current Account — used when supplier/customer/purchase payments are marked Bank (non-cash)
INSERT INTO `Account` (`branchId`, `code`, `name`, `type`, `isSystem`, `createdAt`)
SELECT b.`id`, '1130', 'Bank Current Account', 'Asset', 1, NOW(3)
FROM `Branch` b
WHERE NOT EXISTS (
  SELECT 1 FROM `Account` a WHERE a.`branchId` = b.`id` AND a.`code` = '1130'
);
