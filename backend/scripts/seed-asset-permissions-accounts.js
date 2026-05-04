#!/usr/bin/env node
/**
 * Ensure asset feature permissions and system accounts for existing branches.
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const PERMISSIONS = ["asset.view", "asset.manage"];
const ROLE_GRANTS = {
  Admin: PERMISSIONS,
  Accountant: PERMISSIONS,
  Manager: ["asset.view"],
};
const ACCOUNTS = [
  { code: "1400", name: "Fixed Assets", type: "Asset", isSystem: true },
  { code: "1410", name: "Accumulated Depreciation", type: "Asset", isSystem: true },
];

async function main() {
  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
  }
  console.log(`Permissions ensured: ${PERMISSIONS.join(", ")}`);

  for (const [roleName, codes] of Object.entries(ROLE_GRANTS)) {
    const role = await prisma.role.findFirst({ where: { name: roleName } });
    if (!role) {
      console.log(`Skipping ${roleName} (role not found).`);
      continue;
    }
    const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
    let added = 0;
    for (const p of perms) {
      const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
      });
      if (existing) continue;
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } });
      added += 1;
    }
    console.log(`${roleName}: ${added} new asset permission(s) granted.`);
  }

  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  for (const branch of branches) {
    let added = 0;
    for (const acc of ACCOUNTS) {
      const existing = await prisma.account.findFirst({ where: { branchId: branch.id, code: acc.code } });
      if (existing) continue;
      await prisma.account.create({ data: { branchId: branch.id, ...acc } });
      added += 1;
    }
    console.log(`Branch ${branch.id} (${branch.name}): ${added} asset account(s) added.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
