const prisma = require("../../utils/prisma");

function normalizeCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .slice(0, 48);
}

exports.listCoupons = async (req, res) => {
  try {
    const rows = await prisma.couponCode.findMany({
      where: { branchId: req.branchId },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      take: 200,
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createCoupon = async (req, res) => {
  try {
    const branchId = req.branchId;
    const {
      code,
      discountType,
      discountValue,
      minBasketAmount,
      maxRedemptions,
      isActive,
      startsAt,
      endsAt,
    } = req.body || {};
    const normalized = normalizeCode(code);
    if (!normalized) return res.status(400).json({ error: "code is required" });
    const dtype = String(discountType || "PERCENT").toUpperCase();
    if (!["PERCENT", "AMOUNT"].includes(dtype)) {
      return res.status(400).json({ error: "discountType must be PERCENT or AMOUNT" });
    }
    const dval = Math.max(0, Number(discountValue || 0));
    if (!dval) return res.status(400).json({ error: "discountValue must be > 0" });
    if (dtype === "PERCENT" && dval > 100) {
      return res.status(400).json({ error: "Percent discount cannot exceed 100" });
    }
    const row = await prisma.couponCode.create({
      data: {
        branchId,
        code: normalized,
        discountType: dtype,
        discountValue: dval,
        minBasketAmount: Math.max(0, Number(minBasketAmount || 0)),
        maxRedemptions: Math.max(0, Math.floor(Number(maxRedemptions || 0))),
        isActive: isActive == null ? true : Boolean(isActive),
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
      },
    });
    res.status(201).json(row);
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "A coupon with this code already exists for this branch" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.updateCoupon = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma.couponCode.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Coupon not found" });
    const {
      code,
      discountType,
      discountValue,
      minBasketAmount,
      maxRedemptions,
      isActive,
      startsAt,
      endsAt,
    } = req.body || {};

    const data = {};
    if (code !== undefined) {
      const normalized = normalizeCode(code);
      if (!normalized) return res.status(400).json({ error: "Invalid code" });
      data.code = normalized;
    }
    if (discountType !== undefined) {
      const dtype = String(discountType || "").toUpperCase();
      if (!["PERCENT", "AMOUNT"].includes(dtype)) {
        return res.status(400).json({ error: "discountType must be PERCENT or AMOUNT" });
      }
      data.discountType = dtype;
    }
    if (discountValue !== undefined) {
      data.discountValue = Math.max(0, Number(discountValue || 0));
    }
    if (minBasketAmount !== undefined) data.minBasketAmount = Math.max(0, Number(minBasketAmount || 0));
    if (maxRedemptions !== undefined) data.maxRedemptions = Math.max(0, Math.floor(Number(maxRedemptions || 0)));
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (startsAt !== undefined) data.startsAt = startsAt ? new Date(startsAt) : null;
    if (endsAt !== undefined) data.endsAt = endsAt ? new Date(endsAt) : null;

    const dtypeFinal = String(data.discountType || existing.discountType || "PERCENT").toUpperCase();
    const dvalFinal = data.discountValue != null ? data.discountValue : existing.discountValue;
    if (dtypeFinal === "PERCENT" && Number(dvalFinal) > 100) {
      return res.status(400).json({ error: "Percent discount cannot exceed 100" });
    }

    const updated = await prisma.couponCode.update({
      where: { id },
      data,
    });
    res.json(updated);
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "A coupon with this code already exists for this branch" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.deleteCoupon = async (req, res) => {
  try {
    const branchId = req.branchId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const existing = await prisma.couponCode.findFirst({ where: { id, branchId } });
    if (!existing) return res.status(404).json({ error: "Coupon not found" });
    await prisma.couponCode.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
