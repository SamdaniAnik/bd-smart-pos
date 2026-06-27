const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");
const { resolveFundingAccountCode, isMfsFundingMethod } = require("../../utils/fundingAccount");
const { getPaymentSession, verifyPayment } = require("../payments/mfsPaymentService");
const { sendBulkSms, renderSmsTemplate, isSmsConfigured, getProviderName, sendSms } = require("../../utils/smsGateway");
const {
  getCustomerLedgerStatement,
  formatLedgerLinesBn,
  buildStatementSms,
  recordCreditLedgerEntry,
  DEFAULT_STATEMENT_TEMPLATE,
} = require("../../utils/bakirKhata");

const DEFAULT_DUE_REMINDER_TEMPLATE =
  "প্রিয় {name}, {store} এ আপনার বকেয়া ৳{due}। অনুগ্রহ করে দ্রুত পরিশোধ করুন। ধন্যবাদ।";

/**
 * Send baki (due) reminder SMS to customers with outstanding balance.
 * Payment reminders are transactional messages, so marketingOptIn is not
 * required — but customers without a phone number are skipped.
 */
exports.sendCustomerDueReminders = async (req, res) => {
  try {
    const branchId = req.branchId;
    const customerIds = Array.isArray(req.body?.customerIds)
      ? req.body.customerIds.map(Number).filter((x) => !Number.isNaN(x))
      : [];
    const minDue = Math.max(0, Number(req.body?.minDue || 0));
    const maxCustomers = Math.max(1, Math.min(500, Number(req.body?.maxCustomers || 100)));
    const customTemplate = String(req.body?.messageTemplate || "").trim();

    const customers = await prisma.customer.findMany({
      where: {
        branchId,
        balance: { gt: minDue },
        ...(customerIds.length ? { id: { in: customerIds } } : {}),
      },
      orderBy: { balance: "desc" },
      take: maxCustomers,
      select: { id: true, name: true, phone: true, balance: true },
    });
    const withPhone = customers.filter((c) => String(c.phone || "").trim());
    if (!withPhone.length) {
      return res.status(400).json({ error: "No due customers with phone numbers matched" });
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } });
    const storeName = branch?.name || "আমাদের দোকান";
    const template = customTemplate || DEFAULT_DUE_REMINDER_TEMPLATE;

    const recipients = withPhone.map((c) => ({
      customerId: c.id,
      to: c.phone,
      message: renderSmsTemplate(template, {
        name: c.name || "গ্রাহক",
        store: storeName,
        due: Number(c.balance || 0).toFixed(2),
      }),
    }));

    const { results, summary } = await sendBulkSms(recipients);
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "CUSTOMER_DUE_REMINDER_SMS",
      entity: "Customer",
      entityId: null,
      payload: {
        branchId,
        provider: getProviderName(),
        simulated: !isSmsConfigured(),
        summary,
        customers: results.map((x) => ({
          customerId: x.customerId,
          msisdn: x.msisdn,
          status: x.status,
          error: x.error || null,
        })),
      },
    });

    res.json({
      message: isSmsConfigured()
        ? "Due reminder SMS dispatched"
        : "Due reminder SMS simulated (configure SMS_PROVIDER to send for real)",
      provider: getProviderName(),
      summary,
      skippedNoPhone: customers.length - withPhone.length,
      results: results.map((x) => ({
        customerId: x.customerId,
        msisdn: x.msisdn,
        status: x.status,
        segments: x.segments,
        error: x.error || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

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
    const { customerId, amount, method, note, fundingAccountCode, mfsPaymentId: mfsPaymentIdRaw, trxId: trxIdRaw } = req.body;
    const parsedAmount = Number(amount);
    if (!(parsedAmount > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });

    const fundingCode = resolveFundingAccountCode(method, fundingAccountCode);

    // MFS-funded collection (bKash/Nagad/Rocket/Upay): verify the payment session
    // before recording the receipt so the cash never gets credited without a TrxID.
    let mfsTrxId = null;
    let mfsNote = "";
    if (isMfsFundingMethod(method)) {
      const mfsPaymentId = String(mfsPaymentIdRaw || "").trim();
      if (!mfsPaymentId) {
        return res.status(400).json({ error: "mfsPaymentId is required for MFS due collection (initiate an MFS payment first)" });
      }
      let session = await getPaymentSession(mfsPaymentId);
      if (!session || Number(session.branchId) !== Number(branchId)) {
        return res.status(400).json({ error: "MFS payment session not found or expired" });
      }
      if (session.status !== "VERIFIED") {
        const trx = String(trxIdRaw || "").trim();
        if (!trx) return res.status(400).json({ error: "TrxID required to verify MFS payment" });
        try {
          session = await verifyPayment({ paymentId: mfsPaymentId, trxId: trx });
        } catch (mfsErr) {
          return res.status(400).json({ error: mfsErr.message || "MFS payment verification failed" });
        }
      }
      if (Math.abs(Number(session.amount) - parsedAmount) > 0.05) {
        return res.status(400).json({ error: "MFS verified amount does not match collection amount" });
      }
      mfsTrxId = session.trxId || null;
      mfsNote = mfsTrxId ? ` (TrxID ${mfsTrxId})` : "";
    }

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

      const updatedCustomer = await tx.customer.findUnique({ where: { id: customer.id } });

      const voucher = await tx.receiptVoucher.create({
        data: {
          branchId,
          customerId: customer.id,
          amount: parsedAmount,
          method: method || "Cash",
          note: note ? `${note}${mfsNote}` : mfsNote.trim() || null,
        },
      });

      const accounts = await tx.account.findMany({ where: { branchId } });
      const map = new Map(accounts.map((a) => [a.code, a]));
      const funding =
        map.get(fundingCode) ||
        (isMfsFundingMethod(method) ? map.get("1130") || map.get("1100") : null);
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

      await recordCreditLedgerEntry(tx, {
        branchId,
        customerId: customer.id,
        entryType: "COLLECTION",
        amount: -parsedAmount,
        balanceAfter: Number(updatedCustomer?.balance || 0),
        receiptVoucherId: voucher.id,
        note: note || `Collection via ${method || "Cash"}${mfsNote}`,
        createdById: req.user?.id || null,
      });

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

exports.getBakirKhata = async (req, res) => {
  try {
    const customerId = Number(req.params.customerId);
    if (Number.isNaN(customerId)) return res.status(400).json({ error: "Invalid customer id" });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const statement = await getCustomerLedgerStatement(req.branchId, customerId, { limit });
    res.json(statement);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.sendBakirKhataStatement = async (req, res) => {
  try {
    const customerId = Number(req.params.customerId);
    if (Number.isNaN(customerId)) return res.status(400).json({ error: "Invalid customer id" });
    const customTemplate = String(req.body?.messageTemplate || "").trim();
    const limit = Math.min(Number(req.body?.ledgerLines || 5), 10);

    const statement = await getCustomerLedgerStatement(req.branchId, customerId, { limit: 20 });
    const customer = statement.customer;
    if (!String(customer.phone || "").trim()) {
      return res.status(400).json({ error: "Customer has no phone number for SMS" });
    }

    const branch = await prisma.branch.findUnique({
      where: { id: req.branchId },
      select: { name: true },
    });
    const recentLines = formatLedgerLinesBn(statement.entries, limit);
    const message = buildStatementSms({
      storeName: branch?.name,
      customerName: customer.name,
      due: statement.currentBalance,
      recentLines,
      template: customTemplate || DEFAULT_STATEMENT_TEMPLATE,
    });

    const sms = await sendSms({ to: customer.phone, message, customerId: customer.id });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "BAKIR_KHATA_SMS",
      entity: "Customer",
      entityId: customer.id,
      payload: {
        provider: getProviderName(),
        simulated: !isSmsConfigured(),
        balance: statement.currentBalance,
        smsStatus: sms.status,
      },
    });

    res.json({
      message: isSmsConfigured()
        ? "Bakir Khata statement SMS sent"
        : "Bakir Khata SMS simulated (configure SMS_PROVIDER)",
      provider: getProviderName(),
      smsStatus: sms.status,
      statement: {
        currentBalance: statement.currentBalance,
        entryCount: statement.entries.length,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
