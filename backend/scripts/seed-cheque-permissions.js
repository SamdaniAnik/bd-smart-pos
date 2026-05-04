#!/usr/bin/env node
/**
 * Idempotently insert cheque-register permissions, grant them to default roles,
 * and ensure chart accounts required by cheque clearing/bounce journals.
 *
 * Usage:
 *   node scripts/seed-cheque-permissions.js
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const CHEQUE_PERMISSIONS = ["cheque.view", "cheque.manage", "cheque.clear"];

const ROLE_TEMPLATE_GRANTS = {
  Admin: CHEQUE_PERMISSIONS,
  Accountant: CHEQUE_PERMISSIONS,
  Manager: ["cheque.view", "cheque.manage"],
};

const CHEQUE_ACCOUNTS = [
  { code: "1110", name: "Cheques In Hand", type: "Asset", isSystem: true },
  { code: "2110", name: "Cheques Issued", type: "Liability", isSystem: true },
];

async function main() {
  for (const code of CHEQUE_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code },
    });
  }
  console.log(`Permissions ensured: ${CHEQUE_PERMISSIONS.join(", ")}`);

  for (const [roleName, codes] of Object.entries(ROLE_TEMPLATE_GRANTS)) {
    const role = await prisma.role.findFirst({ where: { name: roleName } });
    if (!role) {
      console.log(`Skipping ${roleName} (role not found).`);
      continue;
    }
    const permissions = await prisma.permission.findMany({
      where: { code: { in: codes } },
    });
    let added = 0;
    for (const p of permissions) {
      const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
      });
      if (existing) continue;
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: p.id },
      });
      added += 1;
    }
    console.log(`${roleName}: ${added} new cheque permission(s) granted.`);
  }

  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  for (const branch of branches) {
    let added = 0;
    for (const account of CHEQUE_ACCOUNTS) {
      const existing = await prisma.account.findFirst({
        where: { branchId: branch.id, code: account.code },
      });
      if (existing) continue;
      await prisma.account.create({
        data: {
          branchId: branch.id,
          code: account.code,
          name: account.name,
          type: account.type,
          isSystem: account.isSystem,
        },
      });
      added += 1;
    }
    console.log(`Branch ${branch.id} (${branch.name}): ${added} cheque account(s) added.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
