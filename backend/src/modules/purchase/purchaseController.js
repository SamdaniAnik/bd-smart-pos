const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");
const PDFDocument = require("pdfkit");

async function getSystemAccount(branchId, code) {
  return prisma.account.findFirst({ where: { branchId, code } });
}

exports.createPurchase = async (req, res) => {
  try {
    const branchId = req.branchId;
    const { supplierId, invoiceNo, items, paidAmount = 0 } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Purchase items required" });
    }
    await ensureOpenFiscalPeriod(branchId);

    const purchase = await prisma.$transaction(async (tx) => {
      let total = 0;
      for (const item of items) total += Number(item.qty) * Number(item.cost);
      const dueAmount = Math.max(0, total - Number(paidAmount));
      const created = await tx.purchase.create({
        data: {
          branchId,
          supplierId: Number(supplierId),
          invoiceNo: invoiceNo || null,
          total,
          paidAmount: Number(paidAmount),
          dueAmount,
          items: {
            create: items.map((i) => ({
              productId: Number(i.productId),
              qty: Number(i.qty),
              cost: Number(i.cost),
            })),
          },
        },
      });

      for (const item of items) {
        const productId = Number(item.productId);
        if (Number(item.qty) <= 0 || Number(item.cost) < 0) {
          throw new Error("Invalid purchase qty/cost");
        }
        await tx.product.update({
          where: { id: productId },
          data: { stock: { increment: Number(item.qty) }, price: Number(item.cost) },
        });
        await tx.stockLedger.create({
          data: {
            branchId,
            productId,
            refType: "PURCHASE",
            refId: created.id,
            inQty: Number(item.qty),
            unitCost: Number(item.cost),
          },
        });
      }

      await tx.supplier.update({
        where: { id: Number(supplierId) },
        data: { payableBalance: { increment: dueAmount } },
      });

      const inventory = await getSystemAccount(branchId, "1300");
      const payable = await getSystemAccount(branchId, "2100");
      const cash = await getSystemAccount(branchId, "1100");
      const journal = await tx.journal.create({
        data: {
          branchId,
          purchaseId: created.id,
          createdBy: req.user?.id || null,
          refType: "PURCHASE",
          refId: created.id,
          narration: `Purchase ${created.id}`,
          lines: {
            create: [
              { accountId: inventory.id, debit: total, credit: 0 },
              { accountId: payable.id, debit: 0, credit: dueAmount },
              { accountId: cash.id, debit: 0, credit: Number(paidAmount) },
            ],
          },
        },
      });
      return { ...created, journalId: journal.id };
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PURCHASE_CREATE",
      entity: "Purchase",
      entityId: purchase.id,
      payload: { supplierId: Number(supplierId), total: purchase.total },
    });
    res.status(201).json(purchase);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPurchases = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchases = await prisma.purchase.findMany({
      where: { branchId },
      include: { supplier: true, items: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(purchases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createPurchaseReturn = async (req, res) => {
  try {
    const branchId = req.branchId;
    const purchaseId = Number(req.params.id);
    if (Number.isNaN(purchaseId)) return res.status(400).json({ error: "Invalid purchase id" });
    const { items, reason } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Return items required" });
    }

    await ensureOpenFiscalPeriod(branchId);

    const purchase = await prisma.purchase.findFirst({
      where: { id: purchaseId, branchId },
      include: { items: true, supplier: true },
    });
    if (!purchase) return res.status(404).json({ error: "Purchase not found" });

    const totalReturnAmount = items.reduce(
      (sum, item) => sum + Number(item.qty || 0) * Number(item.cost || 0),
      0
    );
    if (!(totalReturnAmount > 0)) return res.status(400).json({ error: "Invalid return amount" });

    const created = await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const productId = Number(item.productId);
        const qty = Number(item.qty);
        const cost = Number(item.cost);
        if (!Number.isInteger(qty) || qty <= 0 || cost < 0) {
          throw new Error("Invalid return qty/cost");
        }
        const purchasedItem = purchase.items.find((x) => x.productId === productId);
        if (!purchasedItem) throw new Error(`Product ${productId} not found in purchase`);

        const returnedLedgers = await tx.stockLedger.findMany({
          where: { branchId, refType: "PURCHASE_RETURN", refId: purchaseId, productId },
        });
        const alreadyReturnedQty = returnedLedgers.reduce((sum, l) => sum + Number(l.outQty || 0), 0);
        if (qty > Number(purchasedItem.qty) - alreadyReturnedQty) {
          throw new Error(`Return qty exceeds remaining purchased qty for product ${productId}`);
        }

        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || product.stock < qty) {
          throw new Error(`Insufficient stock for return product ${productId}`);
        }

        await tx.product.update({
          where: { id: productId },
          data: { stock: { decrement: qty } },
        });
        await tx.stockLedger.create({
          data: {
            branchId,
            productId,
            refType: "PURCHASE_RETURN",
            refId: purchaseId,
            outQty: qty,
            unitCost: cost,
          },
        });
      }

      const returnRecord = await tx.purchaseReturn.create({
        data: {
          purchaseId,
          amount: totalReturnAmount,
          reason: reason || null,
        },
      });

      const payableReduction = Math.min(Number(purchase.dueAmount || 0), totalReturnAmount);
      const paidRefund = Math.max(0, totalReturnAmount - payableReduction);
      await tx.supplier.update({
        where: { id: purchase.supplierId },
        data: { payableBalance: { decrement: payableReduction } },
      });
      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          total: { decrement: totalReturnAmount },
          dueAmount: { decrement: payableReduction },
          paidAmount: { decrement: paidRefund },
        },
      });

      const inventory = await getSystemAccount(branchId, "1300");
      const payable = await getSystemAccount(branchId, "2100");
      const cash = await getSystemAccount(branchId, "1100");
      if (inventory && payable && cash) {
        await tx.journal.create({
          data: {
            branchId,
            purchaseId,
            createdBy: req.user?.id || null,
            refType: "PURCHASE_RETURN",
            refId: returnRecord.id,
            narration: `Purchase return ${returnRecord.id}`,
            lines: {
              create: [
                { accountId: payable.id, debit: payableReduction, credit: 0 },
                { accountId: cash.id, debit: paidRefund, credit: 0 },
                { accountId: inventory.id, debit: 0, credit: totalReturnAmount },
              ],
            },
          },
        });
      }

      return returnRecord;
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "PURCHASE_RETURN_CREATE",
      entity: "PurchaseReturn",
      entityId: created.id,
      payload: { purchaseId, amount: created.amount },
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPurchaseReturns = async (req, res) => {
  try {
    const branchId = req.branchId;
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const where = { purchase: { branchId } };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = new Date(`${req.query.to}T23:59:59.999Z`);
    }
    const returns = await prisma.purchaseReturn.findMany({
      where,
      include: {
        purchase: {
          include: {
            supplier: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(returns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((h) => `"${String(row[h] ?? "").replaceAll('"', '""')}"`);
    lines.push(values.join(","));
  }
  return lines.join("\n");
}

function writeReturnsPdf(res, rows) {
  const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="purchase-returns.pdf"');
  doc.pipe(res);
  doc.fontSize(14).font("Helvetica-Bold").text("Purchase Return Report", { align: "center" });
  doc.moveDown(1);
  const cols = ["ID", "Purchase", "Invoice", "Supplier", "Amount", "Reason", "Date"];
  const keys = ["id", "purchaseId", "invoiceNo", "supplierName", "amount", "reason", "date"];
  const startX = 40;
  const width = 515;
  const colW = width / cols.length;
  let y = doc.y;
  doc.fontSize(9).font("Helvetica-Bold");
  cols.forEach((c, i) => doc.text(c, startX + i * colW, y, { width: colW }));
  y += 16;
  doc.font("Helvetica");
  rows.forEach((r) => {
    if (y > 760) {
      doc.addPage();
      y = 50;
    }
    keys.forEach((k, i) => doc.text(String(r[k] ?? ""), startX + i * colW, y, { width: colW }));
    y += 16;
  });
  doc.end();
}

exports.exportPurchaseReturnsCSV = async (req, res) => {
  try {
    req.query = req.query || {};
    const branchId = req.branchId;
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const where = { purchase: { branchId } };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = new Date(`${req.query.to}T23:59:59.999Z`);
    }
    const returns = await prisma.purchaseReturn.findMany({
      where,
      include: { purchase: { include: { supplier: true } } },
      orderBy: { createdAt: "desc" },
    });
    const rows = returns.map((r) => ({
      id: r.id,
      purchase_id: r.purchaseId,
      invoice_no: r.purchase?.invoiceNo || "",
      supplier: r.purchase?.supplier?.name || "",
      amount: Number(r.amount).toFixed(2),
      reason: r.reason || "",
      date: new Date(r.createdAt).toISOString(),
    }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="purchase-returns.csv"');
    res.send(toCSV(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportPurchaseReturnsPDF = async (req, res) => {
  try {
    const branchId = req.branchId;
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const where = { purchase: { branchId } };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = new Date(`${req.query.to}T23:59:59.999Z`);
    }
    const returns = await prisma.purchaseReturn.findMany({
      where,
      include: { purchase: { include: { supplier: true } } },
      orderBy: { createdAt: "desc" },
    });
    const rows = returns.map((r) => ({
      id: r.id,
      purchaseId: r.purchaseId,
      invoiceNo: r.purchase?.invoiceNo || "-",
      supplierName: r.purchase?.supplier?.name || "-",
      amount: Number(r.amount).toFixed(2),
      reason: r.reason || "-",
      date: new Date(r.createdAt).toLocaleString(),
    }));
    writeReturnsPdf(res, rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
