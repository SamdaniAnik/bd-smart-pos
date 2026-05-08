const prisma = require("../../utils/prisma");
const { ensureOpenFiscalPeriod, respondFiscalBlocked } = require("../../utils/fiscal");
const { writeAuditLog } = require("../../utils/audit");

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getPeriodKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function getAccountMap(tx, branchId) {
  const rows = await tx.account.findMany({ where: { branchId } });
  return new Map(rows.map((r) => [r.code, r]));
}

exports.listAssets = async (req, res) => {
  try {
    const branchId = req.branchId;
    const status = String(req.query?.status || "").trim().toUpperCase();
    const rows = await prisma.asset.findMany({
      where: {
        branchId,
        ...(status ? { status } : {}),
      },
      include: {
        depreciationEntries: {
          orderBy: { id: "desc" },
          take: 3,
        },
      },
      orderBy: [{ status: "asc" }, { id: "desc" }],
      take: 1000,
    });
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.createAsset = async (req, res) => {
  try {
    const branchId = req.branchId;
    const name = String(req.body?.name || "").trim();
    const assetCode = String(req.body?.assetCode || "").trim() || null;
    const category = String(req.body?.category || "").trim() || null;
    const purchaseDate = parseDate(req.body?.purchaseDate);
    const inServiceDate = parseDate(req.body?.inServiceDate || req.body?.purchaseDate);
    const cost = Number(req.body?.cost || 0);
    const salvageValue = Number(req.body?.salvageValue || 0);
    const usefulLifeMonths = Number(req.body?.usefulLifeMonths || 0);
    const notes = String(req.body?.notes || "").trim() || null;

    if (!name) return res.status(400).json({ error: "name is required" });
    if (!purchaseDate || !inServiceDate) return res.status(400).json({ error: "valid purchaseDate/inServiceDate required" });
    if (cost <= 0) return res.status(400).json({ error: "cost must be positive" });
    if (salvageValue < 0 || salvageValue >= cost) return res.status(400).json({ error: "salvageValue must be >= 0 and < cost" });
    if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0) {
      return res.status(400).json({ error: "usefulLifeMonths must be a positive integer" });
    }

    await ensureOpenFiscalPeriod(branchId, inServiceDate);
    const created = await prisma.asset.create({
      data: {
        branchId,
        assetCode,
        name,
        category,
        purchaseDate,
        inServiceDate,
        cost,
        salvageValue,
        usefulLifeMonths,
        depreciationMethod: "STRAIGHT_LINE",
        notes,
      },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "ASSET_CREATE",
      entity: "Asset",
      entityId: created.id,
      payload: { branchId, name, assetCode, cost, usefulLifeMonths },
    });
    res.status(201).json(created);
  } catch (error) {
    if (String(error?.code) === "P2002") {
      return res.status(409).json({ error: "Asset code already exists in this branch" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.updateAsset = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid asset id" });
    const existing = await prisma.asset.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Asset not found" });
    if (existing.status === "DISPOSED") return res.status(400).json({ error: "Disposed asset cannot be edited" });

    const nextName = req.body?.name != null ? String(req.body.name).trim() : existing.name;
    const nextCode = req.body?.assetCode != null ? String(req.body.assetCode).trim() || null : existing.assetCode;
    const nextCategory = req.body?.category != null ? String(req.body.category).trim() || null : existing.category;
    const nextPurchaseDate = req.body?.purchaseDate ? parseDate(req.body.purchaseDate) : existing.purchaseDate;
    const nextServiceDate = req.body?.inServiceDate ? parseDate(req.body.inServiceDate) : existing.inServiceDate;
    const nextCost = req.body?.cost != null ? Number(req.body.cost) : Number(existing.cost);
    const nextSalvage = req.body?.salvageValue != null ? Number(req.body.salvageValue) : Number(existing.salvageValue || 0);
    const nextLife = req.body?.usefulLifeMonths != null ? Number(req.body.usefulLifeMonths) : Number(existing.usefulLifeMonths);
    const nextNotes = req.body?.notes != null ? String(req.body.notes || "").trim() || null : existing.notes;

    if (!nextName) return res.status(400).json({ error: "name is required" });
    if (!nextPurchaseDate || !nextServiceDate) return res.status(400).json({ error: "valid purchaseDate/inServiceDate required" });
    if (!(nextCost > 0)) return res.status(400).json({ error: "cost must be positive" });
    if (!(nextSalvage >= 0 && nextSalvage < nextCost)) return res.status(400).json({ error: "salvageValue must be >= 0 and < cost" });
    if (!Number.isInteger(nextLife) || nextLife <= 0) return res.status(400).json({ error: "usefulLifeMonths must be positive integer" });
    await ensureOpenFiscalPeriod(branchId, nextServiceDate);

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        name: nextName,
        assetCode: nextCode,
        category: nextCategory,
        purchaseDate: nextPurchaseDate,
        inServiceDate: nextServiceDate,
        cost: nextCost,
        salvageValue: nextSalvage,
        usefulLifeMonths: nextLife,
        notes: nextNotes,
      },
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "ASSET_UPDATE",
      entity: "Asset",
      entityId: id,
      payload: { branchId },
    });
    res.json(updated);
  } catch (error) {
    if (String(error?.code) === "P2002") {
      return res.status(409).json({ error: "Asset code already exists in this branch" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.disposeAsset = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid asset id" });
    const existing = await prisma.asset.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Asset not found" });
    if (existing.status === "DISPOSED") return res.status(400).json({ error: "Asset already disposed" });
    const disposedAt = parseDate(req.body?.disposedAt) || new Date();
    const disposalValueRaw = req.body?.disposalValue != null ? Number(req.body.disposalValue) : null;
    if (disposalValueRaw != null && (!Number.isFinite(disposalValueRaw) || disposalValueRaw < 0)) {
      return res.status(400).json({ error: "disposalValue must be a valid non-negative number" });
    }
    const disposalValue = disposalValueRaw == null ? null : Number(disposalValueRaw);
    await ensureOpenFiscalPeriod(branchId, disposedAt);
    const posted = await prisma.$transaction(async (tx) => {
      const accounts = await getAccountMap(tx, branchId);
      const fixedAssets = accounts.get("1400");
      const accumDep = accounts.get("1410");
      const cash = accounts.get("1100");
      const gainAcc = accounts.get("4100");
      const lossAcc = accounts.get("5200");
      if (!fixedAssets || !accumDep || !cash || !gainAcc || !lossAcc) {
        throw new Error(
          "Required accounts missing: 1400/1410/1100 and 4100/5200 for disposal gain/loss posting"
        );
      }

      const cost = Number(existing.cost || 0);
      const accumulatedDep = Number(existing.accumulatedDepreciation || 0);
      const bookValue = Math.max(0, cost - accumulatedDep);
      const proceeds = Math.max(0, Number(disposalValue || 0));
      const gain = Math.max(0, Number((proceeds - bookValue).toFixed(2)));
      const loss = Math.max(0, Number((bookValue - proceeds).toFixed(2)));

      const lines = [
        { accountId: accumDep.id, debit: Number(accumulatedDep.toFixed(2)), credit: 0 },
        { accountId: fixedAssets.id, debit: 0, credit: Number(cost.toFixed(2)) },
      ];
      if (proceeds > 0) lines.push({ accountId: cash.id, debit: Number(proceeds.toFixed(2)), credit: 0 });
      if (gain > 0) lines.push({ accountId: gainAcc.id, debit: 0, credit: gain });
      if (loss > 0) lines.push({ accountId: lossAcc.id, debit: loss, credit: 0 });

      const journal = await tx.journal.create({
        data: {
          branchId,
          createdBy: req.user?.id || null,
          refType: "ASSET_DISPOSAL",
          refId: existing.id,
          narration: `Asset disposal ${existing.name}`,
          lines: { create: lines },
        },
      });

      const updated = await tx.asset.update({
        where: { id },
        data: {
          status: "DISPOSED",
          disposedAt,
          disposalValue: Number.isFinite(disposalValue) ? disposalValue : null,
        },
      });
      return { updated, journalId: journal.id, bookValue, proceeds, gain, loss };
    });
    await writeAuditLog({
      userId: req.user?.id || null,
      action: "ASSET_DISPOSE",
      entity: "Asset",
      entityId: id,
      payload: {
        branchId,
        disposedAt: disposedAt.toISOString(),
        disposalValue,
        bookValue: posted.bookValue,
        proceeds: posted.proceeds,
        gain: posted.gain,
        loss: posted.loss,
        journalId: posted.journalId,
      },
    });
    res.json({
      ...posted.updated,
      disposalAccounting: {
        journalId: posted.journalId,
        bookValue: posted.bookValue,
        proceeds: posted.proceeds,
        gain: posted.gain,
        loss: posted.loss,
      },
    });
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.runDepreciation = async (req, res) => {
  try {
    const branchId = req.branchId;
    const asOfDate = parseDate(req.body?.asOfDate) || new Date();
    await ensureOpenFiscalPeriod(branchId, asOfDate);
    const periodKey = getPeriodKey(asOfDate);

    const result = await prisma.$transaction(async (tx) => {
      const accounts = await getAccountMap(tx, branchId);
      const depExpense = accounts.get("5200");
      const accDep = accounts.get("1410");
      if (!depExpense || !accDep) {
        throw new Error("Required accounts missing: 5200 (Depreciation Expense) and 1410 (Accumulated Depreciation)");
      }
      const assets = await tx.asset.findMany({
        where: {
          branchId,
          status: "ACTIVE",
          inServiceDate: { lte: asOfDate },
        },
      });
      let postedCount = 0;
      let postedAmount = 0;
      const postedEntries = [];
      for (const asset of assets) {
        const existingEntry = await tx.assetDepreciationEntry.findUnique({
          where: { assetId_periodKey: { assetId: asset.id, periodKey } },
        });
        if (existingEntry) continue;
        const depreciableBase = Math.max(0, Number(asset.cost || 0) - Number(asset.salvageValue || 0));
        if (depreciableBase <= 0) continue;
        const monthly = depreciableBase / Math.max(1, Number(asset.usefulLifeMonths || 1));
        const remaining = Math.max(0, depreciableBase - Number(asset.accumulatedDepreciation || 0));
        const amount = Number(Math.min(remaining, monthly).toFixed(2));
        if (!(amount > 0)) continue;

        const journal = await tx.journal.create({
          data: {
            branchId,
            createdBy: req.user?.id || null,
            refType: "ASSET_DEPRECIATION",
            refId: asset.id,
            narration: `Asset depreciation ${asset.name} (${periodKey})`,
            lines: {
              create: [
                { accountId: depExpense.id, debit: amount, credit: 0 },
                { accountId: accDep.id, debit: 0, credit: amount },
              ],
            },
          },
        });
        await tx.assetDepreciationEntry.create({
          data: {
            branchId,
            assetId: asset.id,
            periodKey,
            amount,
            runDate: asOfDate,
            journalId: journal.id,
          },
        });
        await tx.asset.update({
          where: { id: asset.id },
          data: {
            accumulatedDepreciation: { increment: amount },
            lastDepreciationDate: asOfDate,
          },
        });
        postedCount += 1;
        postedAmount += amount;
        postedEntries.push({ assetId: asset.id, assetName: asset.name, amount, journalId: journal.id });
      }
      return {
        periodKey,
        asOfDate: asOfDate.toISOString(),
        postedCount,
        postedAmount: Number(postedAmount.toFixed(2)),
        entries: postedEntries,
      };
    });

    await writeAuditLog({
      userId: req.user?.id || null,
      action: "ASSET_DEPRECIATION_RUN",
      entity: "AssetDepreciation",
      entityId: null,
      payload: {
        branchId,
        ...result,
      },
    });
    res.json(result);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};

exports.listDepreciationEntries = async (req, res) => {
  try {
    const branchId = req.branchId;
    const rows = await prisma.assetDepreciationEntry.findMany({
      where: { branchId },
      include: {
        asset: { select: { id: true, name: true, assetCode: true } },
      },
      orderBy: [{ runDate: "desc" }, { id: "desc" }],
      take: 500,
    });
    res.json(rows);
  } catch (error) {
    if (respondFiscalBlocked(res, error)) return;
    res.status(500).json({ error: error.message });
  }
};
