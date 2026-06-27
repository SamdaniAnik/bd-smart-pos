const prisma = require("./prisma");

const DEFAULT_STATEMENT_TEMPLATE =
  "{store} — বাকির খাতা\n{name}, বর্তমান বকেয়া: ৳{due}\n{recentLines}\nধন্যবাদ।";

async function recordCreditLedgerEntry(
  tx,
  { branchId, customerId, entryType, amount, balanceAfter, saleId, receiptVoucherId, note, createdById }
) {
  const client = tx || prisma;
  return client.customerCreditLedger.create({
    data: {
      branchId: Number(branchId),
      customerId: Number(customerId),
      entryType: String(entryType),
      amount: Number(amount),
      balanceAfter: Number(balanceAfter),
      saleId: saleId ? Number(saleId) : null,
      receiptVoucherId: receiptVoucherId ? Number(receiptVoucherId) : null,
      note: note ? String(note).trim().slice(0, 500) : null,
      createdById: createdById || null,
    },
  });
}

async function getCustomerLedgerStatement(branchId, customerId, { limit = 50 } = {}) {
  const customer = await prisma.customer.findFirst({
    where: { id: Number(customerId), branchId: Number(branchId) },
    select: { id: true, name: true, phone: true, balance: true, creditLimit: true },
  });
  if (!customer) throw new Error("Customer not found");

  const entries = await prisma.customerCreditLedger.findMany({
    where: { branchId: Number(branchId), customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(limit) || 50, 200),
  });

  const running = [...entries].reverse();
  return {
    customer,
    currentBalance: Number(customer.balance || 0),
    creditLimit: Number(customer.creditLimit || 0),
    entries: running,
  };
}

function formatLedgerLinesBn(entries, maxLines = 5) {
  const slice = entries.slice(-maxLines);
  if (!slice.length) return "কোনো সাম্প্রতিক লেনদেন নেই।";
  return slice
    .map((row) => {
      const date = new Date(row.createdAt).toLocaleDateString("bn-BD");
      const amt = Number(row.amount || 0);
      const sign = amt >= 0 ? "+" : "";
      const label =
        row.entryType === "SALE_CREDIT"
          ? "বিক্রয় বাকি"
          : row.entryType === "COLLECTION"
            ? "জমা"
            : row.entryType === "ADJUSTMENT"
              ? "সমন্বয়"
              : row.entryType;
      return `${date}: ${label} ${sign}${amt.toFixed(2)} (অবশিষ্ট ৳${Number(row.balanceAfter || 0).toFixed(2)})`;
    })
    .join("\n");
}

function buildStatementSms({ storeName, customerName, due, recentLines, template }) {
  const { renderSmsTemplate } = require("./smsGateway");
  return renderSmsTemplate(template || DEFAULT_STATEMENT_TEMPLATE, {
    store: storeName || "আমাদের দোকান",
    name: customerName || "গ্রাহক",
    due: Number(due || 0).toFixed(2),
    recentLines: recentLines || "",
  });
}

function customerHasKyc(customer) {
  const nid = String(customer?.nidNumber || "").trim();
  const bc = String(customer?.birthCertificateNo || "").trim();
  return nid.length >= 10 || bc.length >= 6;
}

module.exports = {
  DEFAULT_STATEMENT_TEMPLATE,
  recordCreditLedgerEntry,
  getCustomerLedgerStatement,
  formatLedgerLinesBn,
  buildStatementSms,
  customerHasKyc,
};
