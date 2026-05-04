#!/usr/bin/env node
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const PERMS = ["costcenter.view", "costcenter.manage"];
const GRANTS = {
  Admin: PERMS,
  Accountant: PERMS,
  Manager: ["costcenter.view"],
};

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
    console.log(`${roleName}: ${added} new cost center permission(s) granted.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
