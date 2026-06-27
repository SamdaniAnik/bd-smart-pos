const prisma = require("../../utils/prisma");

exports.lookupSerial = async (req, res) => {
  try {
    const branchId = req.branchId;
    const serial = String(req.query.serial || req.query.imei || "").trim();
    if (serial.length < 8) return res.status(400).json({ error: "Serial/IMEI must be at least 8 characters" });
    const item = await prisma.saleItem.findFirst({
      where: {
        serialNumber: serial,
        sale: { branchId },
      },
      include: {
        sale: {
          select: {
            id: true,
            invoiceNo: true,
            createdAt: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
        product: { select: { id: true, name: true, sku: true, warrantyDays: true } },
      },
      orderBy: { id: "desc" },
    });
    if (!item) return res.status(404).json({ error: "Serial/IMEI not found on any sale" });
    const now = new Date();
    const warrantyUntil = item.warrantyUntil ? new Date(item.warrantyUntil) : null;
    res.json({
      serialNumber: item.serialNumber,
      product: item.product,
      sale: item.sale,
      soldAt: item.sale.createdAt,
      warrantyUntil,
      warrantyActive: warrantyUntil ? warrantyUntil >= now : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.checkSerialAvailable = async (req, res) => {
  try {
    const branchId = req.branchId;
    const serial = String(req.query.serial || "").trim();
    if (!serial) return res.status(400).json({ error: "serial is required" });
    const sold = await prisma.saleItem.findFirst({
      where: { serialNumber: serial, sale: { branchId } },
      select: { id: true, saleId: true },
    });
    res.json({ available: !sold, serial });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
