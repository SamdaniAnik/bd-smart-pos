const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");
const { resolveFundingAccountCode } = require("../../utils/fundingAccount");

exports.getDueSummary = async (req, res) => {
  try {
    const branchId = req.branchId;
    const [customers, suppliers, loanAgg] = await Promise.all([
      prisma.customer.findMany({
        where: { branchId, balance: { gt: 0 } },
        orderBy: { balance: "desc" },
      }),
      prisma.supplier.findMany({
        where: { branchId, payableBalance: { gt: 0 } },
        orderBy: { payableBalance: "desc" },
      }),
      prisma.purchase.aggregate({
        where: { branchId, financingSource: "BANK_LOAN", dueAmount: { gt: 0 } },
        _sum: { dueAmount: true },
        _count: { id: true },
      }),
    ]);
    res.json({
      customers,
      suppliers,
      purchaseBankLoans: {
        count: loanAgg._count.id,
        totalOutstanding: Number(Number(loanAgg._sum.dueAmount || 0).toFixed(2)),
      },
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.collectCustomerDue = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { customerId, amount, method, note, fundingAccountCode } = req.body;
    const parsedAmount = Number(amount);
    if (!(parsedAmount > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });

    const fundingCode = resolveFundingAccountCode(method, fundingAccountCode);

    await ensureOpenFiscalPeriod(branchId);
    const created = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: Number(customerId), branchId },
      });
      if (!customer) throw new Error("Customer not found");
      if (parsedAmount > Number(customer.balance || 0)) throw new Error("Collection amount exceeds customer due");

      await tx.customer.update({
        where: { id: customer.id },
        data: { balance: { decrement: parsedAmount } },
      });

      const voucher = await tx.receiptVoucher.create({
        data: {
          branchId,
          customerId: customer.id,
          amount: parsedAmount,
          method: method || "Cash",
          note: note || null,
        },
      });

      const accounts = await tx.account.findMany({ where: { branchId } });
      const map = new Map(accounts.map((a) => [a.code, a]));
      const funding = map.get(fundingCode);
      const receivable = map.get("1200");
      if (funding && receivable) {
        await tx.journal.create({
          data: {
            branchId,
            createdBy: req.user?.id || null,
            refType: "CUSTOMER_COLLECTION",
            refId: voucher.id,
            narration: `Customer collection ${customer.name}`,
            lines: {
              create: [
                { accountId: funding.id, debit: parsedAmount, credit: 0 },
                { accountId: receivable.id, debit: 0, credit: parsedAmount },
              ],
            },
          },
        });
      }

      return voucher;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "CUSTOMER_DUE_COLLECTION",
      entity: "ReceiptVoucher",
      entityId: created.id,
      payload: { amount: parsedAmount },
    });

    res.status(201).json(created);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.paySupplierDue = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { supplierId, amount, method, note, fundingAccountCode } = req.body;
    const parsedAmount = Number(amount);
    if (!(parsedAmount > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });

    const fundingCode = resolveFundingAccountCode(method, fundingAccountCode);

    await ensureOpenFiscalPeriod(branchId);
    const created = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: Number(supplierId), branchId },
      });
      if (!supplier) throw new Error("Supplier not found");
      if (parsedAmount > Number(supplier.payableBalance || 0)) throw new Error("Payment amount exceeds supplier payable");

      await tx.supplier.update({
        where: { id: supplier.id },
        data: { payableBalance: { decrement: parsedAmount } },
      });

      const voucher = await tx.paymentVoucher.create({
        data: {
          branchId,
          supplierId: supplier.id,
          amount: parsedAmount,
          method: method || "Cash",
          note: note || null,
        },
      });

      const accounts = await tx.account.findMany({ where: { branchId } });
      const map = new Map(accounts.map((a) => [a.code, a]));
      const funding = map.get(fundingCode);
      const payable = map.get("2100");
      if (funding && payable) {
        await tx.journal.create({
          data: {
            branchId,
            createdBy: req.user?.id || null,
            refType: "SUPPLIER_PAYMENT",
            refId: voucher.id,
            narration: `Supplier payment ${supplier.name}`,
            lines: {
              create: [
                { accountId: payable.id, debit: parsedAmount, credit: 0 },
                { accountId: funding.id, debit: 0, credit: parsedAmount },
              ],
            },
          },
        });
      }

      return voucher;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "SUPPLIER_DUE_PAYMENT",
      entity: "PaymentVoucher",
      entityId: created.id,
      payload: { amount: parsedAmount },
    });

    res.status(201).json(created);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getCustomerCollections = async (req, res) => {
  try {
    const rows = await prisma.receiptVoucher.findMany({
      where: { branchId: req.branchId },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.getSupplierPayments = async (req, res) => {
  try {
    const rows = await prisma.paymentVoucher.findMany({
      where: { branchId: req.branchId },
      include: { supplier: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};
