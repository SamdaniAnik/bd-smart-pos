// One-time backfill: add AIT (2120) and VDS (2125) liability accounts to every
// existing branch. Safe to re-run — uses upsert keyed on (branchId, code).
//
// Usage:  node scripts/seed-withholding-tax-accounts.js

const prisma = require("../src/utils/prisma");

const NEW_ACCOUNTS = [
  { code: "2120", name: "AIT Payable to NBR", type: "Liability", isSystem: true },
  { code: "2125", name: "VDS Payable to NBR", type: "Liability", isSystem: true },
];

(async () => {
  try {
    const branches = await prisma.branch.findMany({ select: { id: true, code: true, name: true } });
    let touched = 0;
    for (const b of branches) {
      for (const a of NEW_ACCOUNTS) {
        const result = await prisma.account.upsert({
          where: { branchId_code: { branchId: b.id, code: a.code } },
          update: {},
          create: { branchId: b.id, ...a },
        });
        // Result is the row; we don't track inserted vs found here, but the
        // upsert is idempotent so re-running is safe.
        if (result) touched += 1;
      }
      console.log(`Branch ${b.id} (${b.code || b.name}): ensured 2120 + 2125`);
    }
    console.log(`Done. ${touched} account upserts across ${branches.length} branches.`);
  } catch (err) {
    console.error("Backfill failed:", err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
