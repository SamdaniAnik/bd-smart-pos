const prisma = require("./prisma");

async function writeAuditLog({ userId = null, action, entity, entityId = null, payload = null }) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, entity, entityId, payload },
    });
  } catch (error) {
    // Keep audit log failures non-blocking for business operations.
    console.error("Audit log failed:", error.message);
  }
}

module.exports = { writeAuditLog };
