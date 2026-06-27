/**
 * Extended demo data — fills every list/table screen in the app.
 * Called from seed-demo-data.js after core catalog/sales seed.
 */

const DEMO_NOTE = "[DEMO]";

function periodKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function accountId(prisma, branchId, code) {
  const row = await prisma.account.findFirst({ where: { branchId, code } });
  return row?.id || null;
}

async function createJournal(prisma, { branchId, userId, refType, refId, narration, lines, costCenterId }) {
  return prisma.journal.create({
    data: {
      branchId,
      createdBy: userId || null,
      refType,
      refId: refId || null,
      narration,
      costCenterId: costCenterId || null,
      lines: {
        create: lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
        })),
      },
    },
  });
}

async function deleteExtendedDemoData(prisma, branchId) {
  const demoAssets = await prisma.asset.findMany({
    where: { branchId, assetCode: { startsWith: "DEMO-" } },
    select: { id: true },
  });
  if (demoAssets.length) {
    await prisma.assetDepreciationEntry.deleteMany({ where: { assetId: { in: demoAssets.map((a) => a.id) } } });
    await prisma.asset.deleteMany({ where: { id: { in: demoAssets.map((a) => a.id) } } });
  }

  await prisma.chequeEvent.deleteMany({
    where: { cheque: { branchId, chequeNo: { startsWith: "DEMO-CHQ-" } } },
  });
  await prisma.bankStatementAllocation.deleteMany({
    where: {
      branchId,
      line: { import: { branchId, label: { startsWith: "DEMO-BANK-" } } },
    },
  });
  await prisma.bankStatementLine.deleteMany({
    where: { import: { branchId, label: { startsWith: "DEMO-BANK-" } } },
  });
  await prisma.bankStatementImport.deleteMany({ where: { branchId, label: { startsWith: "DEMO-BANK-" } } });
  await prisma.cheque.deleteMany({ where: { branchId, chequeNo: { startsWith: "DEMO-CHQ-" } } });

  const settlements = await prisma.paymentSettlement.findMany({
    where: { branchId, externalRef: { startsWith: "DEMO-SET-" } },
    select: { id: true },
  });
  if (settlements.length) {
    await prisma.salePayment.updateMany({
      where: { settlementId: { in: settlements.map((s) => s.id) } },
      data: { settlementId: null },
    });
    await prisma.paymentSettlement.deleteMany({ where: { id: { in: settlements.map((s) => s.id) } } });
  }

  await prisma.pettyCashClaim.deleteMany({ where: { branchId, description: { contains: DEMO_NOTE } } });
  await prisma.pettyCashTxn.deleteMany({ where: { branchId, description: { contains: DEMO_NOTE } } });
  await prisma.pettyCashFund.deleteMany({ where: { branchId, name: { startsWith: "DEMO " } } });

  const ccRows = await prisma.costCenter.findMany({
    where: { branchId, code: { startsWith: "DEMO-" } },
    select: { id: true },
  });
  if (ccRows.length) {
    await prisma.costCenterBudget.deleteMany({ where: { costCenterId: { in: ccRows.map((c) => c.id) } } });
    await prisma.costCenter.deleteMany({ where: { id: { in: ccRows.map((c) => c.id) } } });
  }

  await prisma.webhookDeliveryLog.deleteMany({
    where: { branchId, event: { startsWith: "DEMO." } },
  });
  await prisma.webhookSubscription.deleteMany({
    where: { branchId, url: { contains: "demo-webhook" } },
  });

  await prisma.stockTransferItem.deleteMany({
    where: { transfer: { fromBranchId: branchId, status: "DEMO_COMPLETED" } },
  });
  await prisma.stockTransfer.deleteMany({ where: { fromBranchId: branchId, status: "DEMO_COMPLETED" } });

  await prisma.stockAdjustment.deleteMany({ where: { branchId, reason: { contains: DEMO_NOTE } } });
  await prisma.stockLedger.deleteMany({ where: { branchId, refType: "DEMO_SEED" } });

  await prisma.paymentVoucher.deleteMany({ where: { branchId, note: { contains: DEMO_NOTE } } });
  await prisma.receiptVoucher.deleteMany({ where: { branchId, note: { contains: DEMO_NOTE } } });

  await prisma.purchaseItem.deleteMany({
    where: { purchase: { branchId, invoiceNo: { startsWith: "DEMO-PUR-" } } },
  });
  await prisma.purchase.deleteMany({ where: { branchId, invoiceNo: { startsWith: "DEMO-PUR-" } } });

  const demoReturns = await prisma.saleReturn.findMany({
    where: { reason: { contains: DEMO_NOTE } },
    select: { id: true },
  });
  if (demoReturns.length) {
    await prisma.saleReturnItem.deleteMany({ where: { saleReturnId: { in: demoReturns.map((r) => r.id) } } });
    await prisma.saleReturn.deleteMany({ where: { id: { in: demoReturns.map((r) => r.id) } } });
  }

  await prisma.journalLine.deleteMany({
    where: { journal: { branchId, narration: { contains: DEMO_NOTE } } },
  });
  await prisma.journal.deleteMany({ where: { branchId, narration: { contains: DEMO_NOTE } } });

  const auditToDelete = await prisma.auditLog.findMany({
    where: {
      OR: [
        { action: { in: ["STOCK_COUNT_SESSION", "STOCK_COUNT_SCHEDULE", "DIGITAL_CASH_TRANSFER"] } },
        { action: { startsWith: "APPROVAL_" } },
        { action: "CUSTOMER_RETENTION_AUTOMATION", entity: "RetentionCampaign" },
      ],
    },
    select: { id: true, payload: true, action: true },
  });
  const auditIds = auditToDelete
    .filter((row) => {
      const p = row.payload || {};
      const blob = JSON.stringify(p);
      if (row.action === "DIGITAL_CASH_TRANSFER") return blob.includes(DEMO_NOTE) || true;
      if (row.action === "CUSTOMER_RETENTION_AUTOMATION") return blob.includes(DEMO_NOTE) || true;
      if (String(row.action || "").startsWith("APPROVAL_")) return blob.includes(DEMO_NOTE);
      if (["STOCK_COUNT_SESSION", "STOCK_COUNT_SCHEDULE"].includes(row.action)) return blob.includes(DEMO_NOTE);
      return false;
    })
    .map((r) => r.id);
  if (auditIds.length) {
    await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
  }

  await prisma.warehouse.deleteMany({
    where: { branchId, name: { in: ["DEMO Back Store", "DEMO Cold Storage"] } },
  });

  await prisma.shift.deleteMany({
    where: { branchId, OR: [{ varianceReason: { contains: "DEMO open shift" } }, { varianceReason: { contains: "DEMO admin history" } }] },
  });

  await prisma.fiscalPeriod.deleteMany({ where: { branchId, name: "DEMO FY 2025 (Closed)" } });
}

async function seedExtendedLists(prisma, ctx) {
  const {
    branchId,
    admin,
    cashier,
    register,
    warehouse,
    products,
    customers,
    suppliers,
    daysAgo,
    daysFromNow,
  } = ctx;

  const userId = admin?.id || cashier?.id;
  const pk = periodKey();

  // —— Warehouses ——
  let backWarehouse = await prisma.warehouse.findFirst({ where: { branchId, name: "DEMO Back Store" } });
  if (!backWarehouse) {
    backWarehouse = await prisma.warehouse.create({ data: { branchId, name: "DEMO Back Store" } });
  }
  let coldWarehouse = await prisma.warehouse.findFirst({ where: { branchId, name: "DEMO Cold Storage" } });
  if (!coldWarehouse) {
    coldWarehouse = await prisma.warehouse.create({ data: { branchId, name: "DEMO Cold Storage" } });
  }

  // —— Cost centers + budgets ——
  let storeOps = await prisma.costCenter.findFirst({ where: { branchId, code: "DEMO-STORE" } });
  if (!storeOps) {
    storeOps = await prisma.costCenter.create({
      data: { branchId, code: "DEMO-STORE", name: "Store Operations" },
    });
  }
  let pharmacyCc = await prisma.costCenter.findFirst({ where: { branchId, code: "DEMO-PHRM" } });
  if (!pharmacyCc) {
    pharmacyCc = await prisma.costCenter.create({
      data: { branchId, code: "DEMO-PHRM", name: "Pharmacy Counter" },
    });
  }
  await prisma.costCenterBudget.upsert({
    where: { costCenterId_periodKey: { costCenterId: storeOps.id, periodKey: pk } },
    update: { expenseBudget: 80000, revenueBudget: 500000 },
    create: {
      branchId,
      costCenterId: storeOps.id,
      periodKey: pk,
      expenseBudget: 80000,
      revenueBudget: 500000,
      note: DEMO_NOTE,
    },
  });

  // —— Extra expenses linked to cost center ——
  if (!(await prisma.expense.findFirst({ where: { branchId, category: "Utilities", description: { contains: DEMO_NOTE } } }))) {
    await prisma.expense.create({
      data: {
        branchId,
        createdBy: userId,
        category: "Utilities",
        description: `Electricity bill ${DEMO_NOTE}`,
        amount: 8500,
        paymentMethod: "Bank",
        costCenterId: storeOps.id,
        expenseDate: daysAgo(5),
      },
    });
  }

  // —— GL journals (accounting trial balance) ——
  const cashAcc = await accountId(prisma, branchId, "1100");
  const salesAcc = await accountId(prisma, branchId, "4100");
  const invAcc = await accountId(prisma, branchId, "1300");
  const opexAcc = await accountId(prisma, branchId, "5200");
  if (cashAcc && salesAcc && !(await prisma.journal.findFirst({ where: { branchId, narration: { contains: "DEMO daily sales GL" } } }))) {
    await createJournal(prisma, {
      branchId,
      userId,
      refType: "DEMO_GL",
      narration: `DEMO daily sales GL ${DEMO_NOTE}`,
      costCenterId: storeOps.id,
      lines: [
        { accountId: cashAcc, debit: 125000, credit: 0 },
        { accountId: salesAcc, debit: 0, credit: 125000 },
      ],
    });
  }
  if (cashAcc && opexAcc && invAcc) {
    if (!(await prisma.journal.findFirst({ where: { branchId, narration: { contains: "DEMO inventory write-off" } } }))) {
      await createJournal(prisma, {
        branchId,
        userId,
        refType: "DEMO_GL",
        narration: `DEMO inventory write-off ${DEMO_NOTE}`,
        lines: [
          { accountId: opexAcc, debit: 1200, credit: 0 },
          { accountId: invAcc, debit: 0, credit: 1200 },
        ],
      });
    }
  }

  // —— Stock adjustments + ledger ——
  if (!(await prisma.stockAdjustment.findFirst({ where: { branchId, reason: { contains: DEMO_NOTE } } }))) {
    const adj = await prisma.stockAdjustment.create({
      data: {
        branchId,
        productId: products.chips.id,
        qtyChange: -3,
        reason: `Damaged display pack ${DEMO_NOTE}`,
        reasonCode: "DAMAGE",
      },
    });
    await prisma.stockLedger.create({
      data: {
        branchId,
        warehouseId: warehouse.id,
        productId: products.chips.id,
        refType: "DEMO_SEED",
        refId: adj.id,
        outQty: 3,
        unitCost: products.chips.unitPrice || 12,
      },
    });
  }

  // —— Stock transfer (same branch demo — list visibility) ——
  if (!(await prisma.stockTransfer.findFirst({ where: { fromBranchId: branchId, status: "DEMO_COMPLETED" } }))) {
    await prisma.stockTransfer.create({
      data: {
        fromBranchId: branchId,
        toBranchId: branchId,
        status: "DEMO_COMPLETED",
        items: {
          create: [
            {
              fromProductId: products.milk.id,
              toProductId: products.milk.id,
              qty: 12,
            },
          ],
        },
      },
    });
  }

  // —— Stock count session + schedule ——
  if (
    !(await prisma.auditLog.findFirst({
      where: { action: "STOCK_COUNT_SESSION", entity: "StockCountSession" },
    }))
  ) {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "STOCK_COUNT_SESSION",
        entity: "StockCountSession",
        payload: {
          branchId,
          warehouseId: backWarehouse.id,
          status: "FINALIZED",
          note: `Monthly count ${DEMO_NOTE}`,
          blindMode: false,
          assignedToUserId: cashier?.id || null,
          assignedToName: cashier?.name || "Demo Cashier",
          recountRound: 0,
          finalizedAt: daysAgo(3).toISOString(),
          items: [
            {
              productId: products.milk.id,
              productName: products.milk.name,
              expectedQty: 48,
              countedQty: 46,
              variance: -2,
              varianceReason: "Shelf shrinkage",
              recountRound: 0,
            },
            {
              productId: products.salt.id,
              productName: products.salt.name,
              expectedQty: 120,
              countedQty: 120,
              variance: 0,
              varianceReason: "",
              recountRound: 0,
            },
          ],
        },
      },
    });
    await prisma.auditLog.create({
      data: {
        userId,
        action: "STOCK_COUNT_SCHEDULE",
        entity: "StockCountSchedule",
        payload: {
          branchId,
          name: `Weekly grocery count ${DEMO_NOTE}`,
          warehouseId: warehouse.id,
          frequency: "weekly",
          isActive: true,
          blindMode: true,
          assignedToUserId: cashier?.id || null,
          assignedToName: cashier?.name || "Demo Cashier",
          note: DEMO_NOTE,
          nextDueAt: daysFromNow(3).toISOString(),
          lastRunAt: daysAgo(4).toISOString(),
        },
      },
    });
  }

  // —— Approvals queue ——
  const approvalActions = [
    { action: "APPROVAL_STOCK_ADJUSTMENT", entity: "StockAdjustment", amount: 5400, reason: `High-value write-off ${DEMO_NOTE}` },
    { action: "APPROVAL_DISCOUNT", entity: "Sale", amount: 850, reason: `Manager discount on wholesale ${DEMO_NOTE}` },
    { action: "APPROVAL_RETURN", entity: "SaleReturn", amount: 120, reason: `Customer return chips ${DEMO_NOTE}` },
    { action: "APPROVAL_PRICE_OVERRIDE", entity: "Sale", amount: 45, reason: `Price match competitor ${DEMO_NOTE}` },
  ];
  for (const ap of approvalActions) {
    const exists = await prisma.auditLog.findFirst({
      where: { action: ap.action, entity: ap.entity },
    });
    if (!exists) {
      await prisma.auditLog.create({
        data: {
          userId: cashier?.id || null,
          action: ap.action,
          entity: ap.entity,
          payload: {
            branchId,
            status: "PENDING",
            amount: ap.amount,
            reason: ap.reason,
            request: { mode: "CREATE", productId: products.chips?.id, qtyChange: -10 },
          },
        },
      });
    }
  }

  // —— Payment settlement + digital cash-out ——
  if (!(await prisma.paymentSettlement.findFirst({ where: { branchId, externalRef: "DEMO-SET-BKASH-01" } }))) {
    const settlement = await prisma.paymentSettlement.create({
      data: {
        branchId,
        provider: "bKash",
        periodStart: daysAgo(7),
        periodEnd: daysAgo(1),
        grossAmount: 15600,
        feeAmount: 234,
        netAmount: 15366,
        externalRef: "DEMO-SET-BKASH-01",
        meta: { note: DEMO_NOTE },
      },
    });
    const bkashPay = await prisma.salePayment.findFirst({
      where: { method: "bKash", channel: "TRX8DEMO9921" },
    });
    if (bkashPay) {
      await prisma.salePayment.update({
        where: { id: bkashPay.id },
        data: { settlementId: settlement.id, reconciledAt: daysAgo(1) },
      });
    }
  }

  if (!(await prisma.auditLog.findFirst({ where: { action: "DIGITAL_CASH_TRANSFER" } }))) {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "DIGITAL_CASH_TRANSFER",
        entity: "Branch",
        entityId: branchId,
        payload: {
          branchId,
          fromMethod: "bKash",
          toMethod: "Bank",
          amount: 15000,
          note: `Weekly MFS to bank sweep ${DEMO_NOTE}`,
          transferredAt: daysAgo(2).toISOString(),
        },
      },
    });
  }

  // —— Bank import ——
  if (!(await prisma.bankStatementImport.findFirst({ where: { branchId, label: "DEMO-BANK-JUN-2026" } }))) {
    const bankImport = await prisma.bankStatementImport.create({
      data: {
        branchId,
        label: "DEMO-BANK-JUN-2026",
        rowCount: 3,
        status: "OPEN",
        meta: { bank: "Dutch-Bangla Bank", accountLast4: "4521" },
      },
    });
    const bkashPay = await prisma.salePayment.findFirst({ where: { method: "bKash", channel: "TRX8DEMO9921" } });
    await prisma.bankStatementLine.createMany({
      data: [
        {
          importId: bankImport.id,
          txnDate: daysAgo(1),
          description: "POS bKash settlement",
          amount: 560,
          direction: "CREDIT",
          reference: "TRX8DEMO9921",
          matchedSalePaymentId: bkashPay?.id || null,
          matchedAt: bkashPay ? daysAgo(1) : null,
        },
        {
          importId: bankImport.id,
          txnDate: daysAgo(2),
          description: "Supplier payment — Pran",
          amount: 6000,
          direction: "DEBIT",
          reference: "DEMO-PUR-001",
        },
        {
          importId: bankImport.id,
          txnDate: daysAgo(0),
          description: "Unmatched deposit — review",
          amount: 2500,
          direction: "CREDIT",
          reference: "MYSTERY-001",
          exceptionStatus: "OPEN",
          exceptionReason: "UNKNOWN_PAYER",
        },
      ],
    });
  }

  // —— Cheques ——
  if (!(await prisma.cheque.findFirst({ where: { branchId, chequeNo: "DEMO-CHQ-RCV-001" } }))) {
    await prisma.cheque.create({
      data: {
        branchId,
        direction: "RECEIVED",
        chequeNo: "DEMO-CHQ-RCV-001",
        bankName: "Islami Bank",
        amount: 25000,
        chequeDate: daysFromNow(7),
        status: "PENDING",
        customerId: customers.karim?.id,
        drawerName: "Karim Traders",
        notes: DEMO_NOTE,
        createdById: userId,
        events: {
          create: [{ eventType: "CREATED", toStatus: "PENDING", actorId: userId }],
        },
      },
    });
    await prisma.cheque.create({
      data: {
        branchId,
        direction: "ISSUED",
        chequeNo: "DEMO-CHQ-PAY-001",
        bankName: "BRAC Bank",
        amount: 15000,
        chequeDate: daysFromNow(3),
        status: "PENDING",
        supplierId: suppliers.pran?.id,
        payeeName: "DEMO Pran-RFL Distributor",
        notes: DEMO_NOTE,
        createdById: userId,
      },
    });
  }

  // —— Assets + depreciation ——
  if (!(await prisma.asset.findFirst({ where: { branchId, assetCode: "DEMO-ASSET-FREEZER" } }))) {
    const asset = await prisma.asset.create({
      data: {
        branchId,
        assetCode: "DEMO-ASSET-FREEZER",
        name: "Display Freezer — Haier",
        category: "Equipment",
        purchaseDate: daysAgo(400),
        inServiceDate: daysAgo(395),
        cost: 85000,
        salvageValue: 5000,
        usefulLifeMonths: 60,
        accumulatedDepreciation: 12000,
        notes: DEMO_NOTE,
      },
    });
    await prisma.assetDepreciationEntry.create({
      data: {
        branchId,
        assetId: asset.id,
        periodKey: pk,
        amount: 1416.67,
        runDate: daysAgo(1),
      },
    });
  }

  // —— Petty cash ——
  let pettyFund = await prisma.pettyCashFund.findFirst({ where: { branchId, name: "DEMO Counter Float" } });
  if (!pettyFund) {
    pettyFund = await prisma.pettyCashFund.create({
      data: {
        branchId,
        name: "DEMO Counter Float",
        custodianName: cashier?.name || "Demo Cashier",
        imprestAmount: 5000,
        currentBalance: 3200,
        note: DEMO_NOTE,
      },
    });
    await prisma.pettyCashTxn.create({
      data: {
        branchId,
        fundId: pettyFund.id,
        type: "TOPUP",
        amount: 5000,
        txnDate: daysAgo(30),
        description: `Initial imprest ${DEMO_NOTE}`,
        createdById: userId,
      },
    });
    await prisma.pettyCashTxn.create({
      data: {
        branchId,
        fundId: pettyFund.id,
        type: "SPEND",
        amount: 450,
        txnDate: daysAgo(2),
        description: `Tea & snacks for staff ${DEMO_NOTE}`,
        createdById: cashier?.id || userId,
      },
    });
    await prisma.pettyCashClaim.create({
      data: {
        branchId,
        fundId: pettyFund.id,
        amount: 850,
        claimDate: daysAgo(1),
        description: `Courier packaging materials ${DEMO_NOTE}`,
        status: "PENDING",
        createdById: cashier?.id || userId,
      },
    });
  }

  // —— Webhooks ——
  let webhook = await prisma.webhookSubscription.findFirst({
    where: { branchId, url: { contains: "demo-webhook" } },
  });
  if (!webhook) {
    webhook = await prisma.webhookSubscription.create({
      data: {
        branchId,
        url: "https://demo-webhook.bdpos.local/hooks/sale-completed",
        secret: "demo-secret",
        events: ["sale.completed", "order.inbound", "stock.low"],
        isActive: true,
      },
    });
    await prisma.webhookDeliveryLog.createMany({
      data: [
        {
          branchId,
          webhookSubscriptionId: webhook.id,
          event: "DEMO.sale.completed",
          url: webhook.url,
          ok: true,
          statusCode: 200,
          durationMs: 142,
        },
        {
          branchId,
          webhookSubscriptionId: webhook.id,
          event: "DEMO.stock.low",
          url: webhook.url,
          ok: false,
          statusCode: 503,
          errorMessage: "Connection timeout (demo)",
          durationMs: 5000,
        },
      ],
    });
  }

  // —— Supplier AP + vouchers ——
  if (suppliers.pran) {
    await prisma.supplier.update({
      where: { id: suppliers.pran.id },
      data: { payableBalance: 12500 },
    });
  }
  if (!(await prisma.paymentVoucher.findFirst({ where: { branchId, note: { contains: DEMO_NOTE } } }))) {
    await prisma.paymentVoucher.create({
      data: {
        branchId,
        supplierId: suppliers.pran?.id,
        amount: 10000,
        method: "Bank",
        note: `Partial AP payment ${DEMO_NOTE}`,
        aitRate: 4,
        aitAmount: 400,
        netPaid: 9600,
      },
    });
  }
  if (!(await prisma.receiptVoucher.findFirst({ where: { branchId, note: { contains: DEMO_NOTE } } }))) {
    await prisma.receiptVoucher.create({
      data: {
        branchId,
        customerId: customers.rahim?.id,
        amount: 1000,
        method: "Cash",
        note: `Partial due collection ${DEMO_NOTE}`,
      },
    });
  }

  // —— Sale return history ——
  const saleForReturn = await prisma.sale.findFirst({
    where: { branchId, invoiceNo: { startsWith: "DEMO-INV-" } },
    orderBy: { id: "asc" },
  });
  if (saleForReturn && !(await prisma.saleReturn.findFirst({ where: { saleId: saleForReturn.id } }))) {
    await prisma.saleReturn.create({
      data: {
        saleId: saleForReturn.id,
        amount: 40,
        reason: `Customer returned 2x chips ${DEMO_NOTE}`,
        items: {
          create: [{ productId: products.chips.id, qty: 2, amount: 40 }],
        },
      },
    });
  }

  // —— Loyalty redemption sale ——
  if (!(await prisma.sale.findFirst({ where: { branchId, notes: { contains: "loyalty_redeem_demo" } } }))) {
    await prisma.sale.create({
      data: {
        branchId,
        cashierId: cashier?.id,
        customerId: customers.fatima?.id,
        invoiceNo: `DEMO-INV-LOYALTY-${Date.now().toString().slice(-4)}`,
        subTotal: 200,
        total: 140,
        paidAmount: 140,
        dueAmount: 0,
        paymentMethod: "Cash",
        notes: JSON.stringify({
          loyalty_redeem_demo: true,
          loyalty: { redeemedPoints: 120, redeemedAmount: 60, tierDiscountAmount: 0 },
        }),
        items: {
          create: [
            {
              productId: products.chips.id,
              qty: 10,
              price: 20,
              cost: 12,
            },
          ],
        },
      },
    });
  }

  // —— Loyalty retention automation ——
  if (!(await prisma.auditLog.findFirst({ where: { action: "CUSTOMER_RETENTION_AUTOMATION" } }))) {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "CUSTOMER_RETENTION_AUTOMATION",
        entity: "RetentionCampaign",
        payload: {
          branchId,
          name: `Win-back SMS campaign ${DEMO_NOTE}`,
          segment: "at_risk",
          channel: "SMS",
          status: "SCHEDULED",
          scheduledAt: daysFromNow(1).toISOString(),
          targetCount: 12,
        },
      },
    });
  }

  // —— Dispensed prescription ——
  if (!(await prisma.prescription.findFirst({ where: { branchId, prescriptionNo: "DEMO-RX-DONE" } }))) {
    await prisma.prescription.create({
      data: {
        branchId,
        prescriptionNo: "DEMO-RX-DONE",
        patientName: "Ayesha Khatun",
        patientPhone: "01987654321",
        doctorName: "Dr. Sabrina",
        status: "DISPENSED",
        customerId: customers.fatima?.id,
        dispensedAt: daysAgo(2),
        dispensedById: userId,
        notes: DEMO_NOTE,
        lines: {
          create: [{ productId: products.napa.id, qty: 10, dosageNote: "1+0+1" }],
        },
      },
    });
  }

  // —— Fiscal period (closed prior year) ——
  if (!(await prisma.fiscalPeriod.findFirst({ where: { branchId, name: "DEMO FY 2025 (Closed)" } }))) {
    await prisma.fiscalPeriod.create({
      data: {
        branchId,
        name: "DEMO FY 2025 (Closed)",
        startDate: new Date(2025, 0, 1),
        endDate: new Date(2025, 11, 31, 23, 59, 59),
        isClosed: true,
      },
    });
  }

  // —— Tax profile ——
  if (!(await prisma.taxProfile.findFirst({ where: { branchId, name: "DEMO VAT 15%" } }))) {
    await prisma.taxProfile.create({
      data: { branchId, name: "DEMO VAT 15%", rate: 15 },
    });
  }

  // —— Shifts: open for admin + admin history ——
  if (admin && !(await prisma.shift.findFirst({ where: { branchId, userId: admin.id, closedAt: null } }))) {
    await prisma.shift.create({
      data: {
        branchId,
        userId: admin.id,
        registerId: register.id,
        openingCash: 3000,
        varianceReason: `DEMO open shift ${DEMO_NOTE}`,
      },
    });
  }
  if (admin && !(await prisma.shift.findFirst({ where: { branchId, userId: admin.id, varianceReason: { contains: "DEMO admin history" } } }))) {
    await prisma.shift.create({
      data: {
        branchId,
        userId: admin.id,
        registerId: register.id,
        openedAt: daysAgo(2),
        closedAt: daysAgo(2),
        openingCash: 2000,
        closingCash: 8750,
        varianceReason: `DEMO admin history ${DEMO_NOTE}`,
      },
    });
  }

  // —— Purchase with due (supplier credit) ——
  if (!(await prisma.purchase.findFirst({ where: { branchId, invoiceNo: "DEMO-PUR-002" } }))) {
    await prisma.purchase.create({
      data: {
        branchId,
        supplierId: suppliers.aci?.id || suppliers.pran?.id,
        invoiceNo: "DEMO-PUR-002",
        total: 8500,
        paidAmount: 0,
        dueAmount: 8500,
        financingSource: "SUPPLIER_CREDIT",
        items: {
          create: [{ productId: products.napa.id, qty: 100, cost: 2.2 }],
        },
      },
    });
  }

  return { backWarehouse, coldWarehouse, storeOps };
}

module.exports = { seedExtendedLists, deleteExtendedDemoData, DEMO_NOTE };
