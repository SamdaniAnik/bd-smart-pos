#!/usr/bin/env node
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const PERMS = ["pettycash.view", "pettycash.manage"];
const GRANTS = {
  Admin: PERMS,
  Accountant: PERMS,
  Manager: ["pettycash.view"],
};
const PETTY_CASH_ACCOUNT = { code: "1120", name: "Petty Cash", type: "Asset", isSystem: true };

async function main() {
  for (const code of PERMS) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
  }
  console.log(`Permissions ensured: ${PERMS.join(", ")}`);

  for (const [roleName, codes] of Object.entries(GRANTS)) {
    const role = await prisma.role.findFirst({ where: { name: roleName } });
    if (!role) {
      console.log(`Skipping ${roleName} (role not found).`);
      continue;
    }
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    let added = 0;
    for (const p of permissions) {
      const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
      });
      if (existing) continue;
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } });
      added += 1;
    }
    console.log(`${roleName}: ${added} new petty cash permission(s) granted.`);
  }

  const branches = await prisma.branch.findMany({ select: { id: true } });
  let accountsEnsured = 0;
  for (const branch of branches) {
    await prisma.account.upsert({
      where: { branchId_code: { branchId: branch.id, code: PETTY_CASH_ACCOUNT.code } },
      update: {},
      create: { branchId: branch.id, ...PETTY_CASH_ACCOUNT },
    });
    accountsEnsured += 1;
  }
  console.log(`Petty cash account ${PETTY_CASH_ACCOUNT.code} ensured for ${accountsEnsured} branch(es).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
