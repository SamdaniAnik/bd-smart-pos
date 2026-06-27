/**
 * Demo / customer-presentation seed data for BD Smart POS.
 *
 * Prerequisites: run bootstrap first (POST /api/bootstrap/seed or existing admin branch).
 *
 * Usage:
 *   node scripts/seed-demo-data.js
 *   node scripts/seed-demo-data.js --reset
 *   node scripts/seed-demo-data.js --branch-id=1
 */

require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const prisma = require("../src/utils/prisma");
const { ensureDefaultOrganization } = require("../src/utils/subscriptionUtil");
const { seedExtendedLists, deleteExtendedDemoData } = require("./demo/seedExtendedLists");

const DEMO_NOTE = "[DEMO]";
const DEMO_SKU_PREFIX = "DEMO-";

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    reset: args.includes("--reset"),
    branchId: Number(args.find((a) => a.startsWith("--branch-id="))?.split("=")[1] || 0),
  };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(11, 30, 0, 0);
  return d;
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function invoiceNo(seq) {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `DEMO-INV-${datePart}-${String(seq).padStart(3, "0")}`;
}

async function resolveBranchId(explicitId) {
  if (explicitId) {
    const b = await prisma.branch.findUnique({ where: { id: explicitId } });
    if (!b) throw new Error(`Branch ${explicitId} not found`);
    return b.id;
  }
  const bootstrapped = await prisma.branch.findFirst({
    where: { bootstrapped: true },
    orderBy: { id: "asc" },
  });
  if (bootstrapped) return bootstrapped.id;
  const any = await prisma.branch.findFirst({ orderBy: { id: "asc" } });
  if (!any) {
    throw new Error("No branch found. Run POST /api/bootstrap/seed first.");
  }
  return any.id;
}

async function deleteDemoData(branchId) {
  await deleteExtendedDemoData(prisma, branchId);

  const demoProducts = await prisma.product.findMany({
    where: { branchId, sku: { startsWith: DEMO_SKU_PREFIX } },
    select: { id: true },
  });
  const productIds = demoProducts.map((p) => p.id);

  const demoSales = await prisma.sale.findMany({
    where: {
      branchId,
      OR: [{ invoiceNo: { startsWith: "DEMO-INV-" } }, { notes: { contains: DEMO_NOTE } }],
    },
    select: { id: true },
  });
  const saleIds = demoSales.map((s) => s.id);

  const demoSaleItems =
    saleIds.length > 0
      ? await prisma.saleItem.findMany({ where: { saleId: { in: saleIds } }, select: { id: true } })
      : [];
  const saleItemIds = demoSaleItems.map((i) => i.id);

  const demoReturnIds = (
    await prisma.saleReturn.findMany({
      where: {
        OR: [
          ...(saleIds.length ? [{ saleId: { in: saleIds } }] : []),
          { reason: { contains: DEMO_NOTE } },
        ],
      },
      select: { id: true },
    })
  ).map((r) => r.id);
  if (demoReturnIds.length) {
    await prisma.saleReturnItem.deleteMany({ where: { saleReturnId: { in: demoReturnIds } } });
    await prisma.saleReturn.deleteMany({ where: { id: { in: demoReturnIds } } });
  }

  if (saleItemIds.length) {
    await prisma.saleItemBatch.deleteMany({ where: { saleItemId: { in: saleItemIds } } });
  }
  if (saleIds.length) {
    await prisma.salePayment.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.storedValueTxn.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
  }

  await prisma.kitchenTicket.deleteMany({
    where: { branchId, OR: [{ ticketNo: { startsWith: "DEMO-KOT-" } }, { notes: { contains: DEMO_NOTE } }] },
  });
  await prisma.restaurantTable.deleteMany({ where: { branchId, code: { startsWith: "DEMO-T" } } });

  await prisma.courierShipment.deleteMany({
    where: { branchId, OR: [{ trackingId: { startsWith: "DEMO-TRK-" } }, { recipientName: { contains: DEMO_NOTE } }] },
  });
  await prisma.pendingOrder.deleteMany({
    where: { branchId, OR: [{ orderNo: { startsWith: "DEMO-ORD-" } }, { notes: { contains: DEMO_NOTE } }] },
  });

  const demoPrescriptions = await prisma.prescription.findMany({
    where: { branchId, notes: { contains: DEMO_NOTE } },
    select: { id: true },
  });
  if (demoPrescriptions.length) {
    await prisma.prescriptionLine.deleteMany({
      where: { prescriptionId: { in: demoPrescriptions.map((p) => p.id) } },
    });
    await prisma.prescription.deleteMany({ where: { id: { in: demoPrescriptions.map((p) => p.id) } } });
  }

  if (productIds.length) {
    await prisma.productionOrder.deleteMany({
      where: { branchId, recipe: { finishedProductId: { in: productIds } } },
    });
    await prisma.manufacturingRecipe.deleteMany({
      where: { branchId, finishedProductId: { in: productIds } },
    });
    await prisma.stockLedger.deleteMany({ where: { branchId, productId: { in: productIds } } });
    await prisma.stockAdjustment.deleteMany({ where: { branchId, productId: { in: productIds } } });
    await prisma.inventoryBatch.deleteMany({ where: { branchId, productId: { in: productIds } } });
    await prisma.productBarcode.deleteMany({ where: { branchId, productId: { in: productIds } } });
    await prisma.productVariant.deleteMany({ where: { branchId, productId: { in: productIds } } });
    await prisma.productPriceList.deleteMany({ where: { branchId, productId: { in: productIds } } });
    await prisma.promotionRule.deleteMany({ where: { branchId, name: { startsWith: "DEMO " } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }

  await prisma.couponCode.deleteMany({ where: { branchId, code: { startsWith: "DEMO" } } });
  await prisma.giftCard.deleteMany({ where: { branchId, code: { startsWith: "DEMO-GIFT-" } } });
  await prisma.purchaseItem.deleteMany({
    where: { purchase: { branchId, invoiceNo: { startsWith: "DEMO-PUR-" } } },
  });
  await prisma.purchase.deleteMany({ where: { branchId, invoiceNo: { startsWith: "DEMO-PUR-" } } });
  await prisma.expense.deleteMany({ where: { branchId, description: { contains: DEMO_NOTE } } });

  await prisma.customer.deleteMany({
    where: {
      branchId,
      phone: { in: ["01711111111", "01722222222", "01733333333", "01844444444"] },
    },
  });
  await prisma.supplier.deleteMany({
    where: { branchId, name: { in: ["DEMO Pran-RFL Distributor", "DEMO ACI Logistics"] } },
  });

  await prisma.auditLog.deleteMany({
    where: {
      action: "POS_SALES_QUOTE",
      entity: "SalesQuote",
    },
  });

  console.log("Cleared previous demo records.");
}

async function upsertProduct(branchId, categoryId, data) {
  const existing = await prisma.product.findFirst({
    where: { branchId, sku: data.sku },
  });
  if (existing) {
    return prisma.product.update({
      where: { id: existing.id },
      data: { ...data, categoryId: categoryId || existing.categoryId, internalNotes: DEMO_NOTE },
    });
  }
  return prisma.product.create({
    data: { branchId, categoryId, ...data, internalNotes: DEMO_NOTE },
  });
}

async function upsertCustomer(branchId, data) {
  const existing = await prisma.customer.findFirst({
    where: { branchId, phone: data.phone },
  });
  if (existing) {
    return prisma.customer.update({ where: { id: existing.id }, data });
  }
  return prisma.customer.create({ data: { branchId, ...data } });
}

async function createDemoSale(tx, opts) {
  const {
    branchId,
    cashierId,
    customerId,
    invoice,
    items,
    paymentMethod,
    paidAmount,
    dueAmount = 0,
    createdAt = new Date(),
    fulfillmentType = "PICKUP",
    deliveryFee = 0,
    deliveryAddress,
    deliveryDistrict,
    deliveryArea,
    courierName,
    trackingId,
    orderSource,
    codStatus,
    codExpectedAmount = 0,
    prescriptionId,
    batchLinks = [],
  } = opts;

  let subTotal = 0;
  const linePayloads = [];
  for (const line of items) {
    const product = await tx.product.findFirst({ where: { id: line.productId, branchId } });
    if (!product) continue;
    const qty = Number(line.qty || 1);
    const weightKg = line.weightKg != null ? Number(line.weightKg) : null;
    const price = Number(line.price ?? product.price);
    const billUnits = product.sellByWeight ? Math.max(0, weightKg || qty) : qty;
    subTotal += billUnits * price;
    const serialNumber = line.serialNumber ? String(line.serialNumber).slice(0, 64) : null;
    const warrantyDays = Number(product.warrantyDays || 0);
    linePayloads.push({
      productId: product.id,
      productVariantId: line.variantId || null,
      qty,
      weightKg,
      saleUnit: product.saleUnit || product.unitOfMeasure || "PCS",
      price,
      cost: Number(product.unitPrice || 0),
      serialNumber,
      warrantyUntil:
        serialNumber && warrantyDays > 0 ? daysFromNow(warrantyDays) : null,
    });
  }

  const total = Math.round((subTotal + Number(deliveryFee || 0)) * 100) / 100;
  const paid = Math.round(Number(paidAmount || 0) * 100) / 100;
  const due = dueAmount != null ? Number(dueAmount) : Math.max(0, total - paid);

  const sale = await tx.sale.create({
    data: {
      branchId,
      cashierId: cashierId || null,
      customerId: customerId || null,
      prescriptionId: prescriptionId || null,
      invoiceNo: invoice,
      subTotal,
      vatAmount: 0,
      discount: 0,
      total,
      paidAmount: paid,
      dueAmount: due,
      paymentMethod: paymentMethod || "Cash",
      paymentChannel: opts.paymentChannel || null,
      notes: DEMO_NOTE,
      fulfillmentType,
      deliveryFee: Number(deliveryFee || 0),
      deliveryAddress: deliveryAddress || null,
      deliveryDistrict: deliveryDistrict || null,
      deliveryArea: deliveryArea || null,
      courierName: courierName || null,
      trackingId: trackingId || null,
      orderSource: orderSource || null,
      codStatus: codStatus || null,
      codExpectedAmount: Number(codExpectedAmount || 0),
      createdAt,
      items: { create: linePayloads },
    },
    include: { items: true },
  });

  if (paid > 0) {
    await tx.salePayment.create({
      data: {
        saleId: sale.id,
        method: paymentMethod || "Cash",
        channel: opts.paymentChannel || null,
        amount: paid,
      },
    });
  }

  for (const line of sale.items) {
    const src = items.find((x) => x.productId === line.productId);
    const product = await tx.product.findUnique({ where: { id: line.productId } });
    if (!product) continue;
    if (product.sellByWeight) {
      await tx.product.update({
        where: { id: product.id },
        data: { stockKg: { decrement: Number(line.weightKg || line.qty || 0) } },
      });
    } else if (line.productVariantId) {
      await tx.productVariant.update({
        where: { id: line.productVariantId },
        data: { stock: { decrement: Math.ceil(Number(line.qty || 1)) } },
      });
      await tx.product.update({
        where: { id: product.id },
        data: { stock: { decrement: Math.ceil(Number(line.qty || 1)) } },
      });
    } else {
      await tx.product.update({
        where: { id: product.id },
        data: { stock: { decrement: Math.ceil(Number(line.qty || 1)) } },
      });
    }
    const batchId = batchLinks.find((b) => b.productId === line.productId)?.batchId;
    if (batchId) {
      await tx.saleItemBatch.create({
        data: { saleItemId: line.id, batchId, qty: Math.ceil(Number(line.qty || 1)) },
      });
      await tx.inventoryBatch.update({
        where: { id: batchId },
        data: { qtyOnHand: { decrement: Math.ceil(Number(line.qty || 1)) } },
      });
    }
    void src;
  }

  if (customerId && due > 0) {
    await tx.customer.update({
      where: { id: customerId },
      data: { balance: { increment: due } },
    });
  }

  return sale;
}

async function seedDemo(branchId) {
  const org = await ensureDefaultOrganization();
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      name: "Demo Retail Group",
      planCode: "pro",
      subscriptionStatus: "ACTIVE",
      billingEmail: "owner@demo.bdpos.local",
      currentPeriodEnd: daysFromNow(30),
      bdtMonthlyFee: 3500,
    },
  });

  const admin = await prisma.user.findFirst({
    where: { branchId, email: "admin@bdpos.local" },
    include: { role: true },
  });
  let cashier = await prisma.user.findUnique({ where: { email: "cashier@bdpos.local" } });
  if (!cashier) {
    let cashierRole = await prisma.role.findUnique({ where: { name: "Cashier" } });
    if (!cashierRole) {
      cashierRole = await prisma.role.create({ data: { name: "Cashier" } });
      const codes = ["sale.view", "sale.create", "product.view", "customer.view", "inventory.view"];
      const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
      for (const p of perms) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: cashierRole.id, permissionId: p.id } },
          update: {},
          create: { roleId: cashierRole.id, permissionId: p.id },
        });
      }
    }
    cashier = await prisma.user.create({
      data: {
        branchId,
        roleId: cashierRole.id,
        name: "Demo Cashier",
        email: "cashier@bdpos.local",
        passwordHash: await bcrypt.hash("123456", 10),
      },
    });
  }

  const existingBranch = await prisma.branch.findUnique({ where: { id: branchId } });
  await prisma.branch.update({
    where: { id: branchId },
    data: {
      name: "Demo Store — Gulshan",
      code: `DEMO-BR-${branchId}`,
      address: "Road 11, Gulshan-2, Dhaka 1212",
      phone: "01700000000",
      sellerBin: "000123456-0101",
      tradeLicenseNo: "TRAD/DHA/2024/88421",
      vatRegistrationLabel: "VAT-REG-DEMO-001",
      businessProfile: "MIXED",
      costingMethod: "WEIGHTED_AVG",
      scalePluDigits: 5,
      ownerPhone: "8801711111111",
      digestEnabled: true,
      digestHour: 21,
      courierProvider: "log",
      courierStoreId: "DEMO-PATHAO-STORE",
      storefrontToken: existingBranch?.storefrontToken || crypto.randomBytes(24).toString("hex"),
      organizationId: org.id,
      loyaltyAisleBonusJson: JSON.stringify({ GROCERY: 2, PHARMACY: 1.5 }),
      loyaltyPointsExpiryDays: 365,
    },
  });

  let warehouse = await prisma.warehouse.findFirst({ where: { branchId, name: "Main Store" } });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({ data: { branchId, name: "Main Store" } });
  }

  let register = await prisma.cashRegister.findFirst({ where: { branchId, name: "Counter 1" } });
  if (!register) {
    register = await prisma.cashRegister.create({ data: { branchId, name: "Counter 1" } });
  }

  const categories = await prisma.productCategory.findMany({ where: { branchId } });
  const catByName = (name) => categories.find((c) => c.name === name)?.id || null;

  const products = {};

  products.milk = await upsertProduct(branchId, catByName("DAIRY"), {
    name: "Pran Full Cream Milk 1L",
    nameBn: "প্রাণ ফুল ক্রিম দুধ ১ লিটার",
    sku: `${DEMO_SKU_PREFIX}GROC-MILK`,
    barcode: "8801001001011",
    category: "DAIRY",
    unitPrice: 95,
    price: 120,
    stock: 48,
    vatRate: 0,
    reorderLevel: 12,
  });

  products.salt = await upsertProduct(branchId, catByName("GROCERY"), {
    name: "ACI Pure Salt 1kg",
    nameBn: "এসিআই খাঁটি লবণ ১ কেজি",
    sku: `${DEMO_SKU_PREFIX}GROC-SALT`,
    barcode: "8801001001012",
    category: "GROCERY",
    unitPrice: 28,
    price: 38,
    stock: 120,
    vatRate: 0,
    reorderLevel: 20,
  });

  products.potato = await upsertProduct(branchId, catByName("GROCERY"), {
    name: "Fresh Potato (Alu)",
    nameBn: "তাজা আলু",
    sku: `${DEMO_SKU_PREFIX}GROC-POTATO`,
    barcode: "8801001001013",
    category: "GROCERY",
    unitPrice: 35,
    price: 55,
    stock: 0,
    stockKg: 85.5,
    sellByWeight: true,
    saleUnit: "KG",
    unitOfMeasure: "KG",
    vatRate: 0,
    reorderLevel: 10,
  });

  products.napa = await upsertProduct(branchId, catByName("OTC"), {
    name: "Napa Extend 665mg",
    nameBn: "নাপা এক্সটেন্ড",
    sku: `${DEMO_SKU_PREFIX}PHRM-NAPA`,
    barcode: "8801001002011",
    category: "OTC",
    genericName: "Paracetamol",
    strength: "665mg",
    dosageForm: "Tablet",
    unitPrice: 2.2,
    price: 3.5,
    stock: 200,
    vatRate: 0,
    batchTracked: true,
    trackExpiry: true,
    reorderLevel: 50,
  });

  products.seclo = await upsertProduct(branchId, catByName("MEDICINE"), {
    name: "Seclo 20mg Capsule",
    nameBn: "সেকলো ২০ মি.গ্রা.",
    sku: `${DEMO_SKU_PREFIX}PHRM-SECLO`,
    barcode: "8801001002012",
    category: "MEDICINE",
    genericName: "Omeprazole",
    strength: "20mg",
    dosageForm: "Capsule",
    unitPrice: 6,
    price: 9,
    stock: 80,
    vatRate: 0,
    reorderLevel: 20,
  });

  products.phone = await upsertProduct(branchId, catByName("ACCESSORIES"), {
    name: "Samsung Galaxy A15",
    nameBn: "স্যামসাং গ্যালাক্সি A15",
    sku: `${DEMO_SKU_PREFIX}MOB-A15`,
    barcode: "8801001003011",
    category: "ACCESSORIES",
    brand: "Samsung",
    model: "SM-A155F",
    unitPrice: 18500,
    price: 22999,
    stock: 5,
    vatRate: 0,
    trackSerial: true,
    warrantyDays: 365,
    reorderLevel: 2,
  });

  products.biryani = await upsertProduct(branchId, catByName("GROCERY"), {
    name: "Chicken Biryani (Full)",
    nameBn: "মুরগি বিরিয়ানি (ফুল)",
    sku: `${DEMO_SKU_PREFIX}REST-BIRY`,
    barcode: "8801001004011",
    category: "GROCERY",
    unitPrice: 180,
    price: 280,
    stock: 999,
    vatRate: 0,
  });

  products.tehari = await upsertProduct(branchId, catByName("GROCERY"), {
    name: "Beef Tehari",
    nameBn: "গরুর তেহারি",
    sku: `${DEMO_SKU_PREFIX}REST-TEH`,
    barcode: "8801001004012",
    category: "GROCERY",
    unitPrice: 200,
    price: 320,
    stock: 999,
    vatRate: 0,
  });

  products.lassi = await upsertProduct(branchId, catByName("BEVERAGES"), {
    name: "Mishti Lassi",
    nameBn: "মিষ্টি লassi",
    sku: `${DEMO_SKU_PREFIX}REST-LASSI`,
    barcode: "8801001004013",
    category: "BEVERAGES",
    unitPrice: 35,
    price: 60,
    stock: 999,
    vatRate: 0,
  });

  products.tshirt = await upsertProduct(branchId, catByName("APPAREL"), {
    name: "Cotton T-Shirt",
    nameBn: "কটন টি-শার্ট",
    sku: `${DEMO_SKU_PREFIX}FASH-TSH`,
    barcode: "8801001005011",
    category: "APPAREL",
    unitPrice: 220,
    price: 450,
    stock: 0,
    hasVariants: true,
    vatRate: 0,
  });

  let tshirtVariants = await prisma.productVariant.findMany({
    where: { branchId, productId: products.tshirt.id },
  });
  if (!tshirtVariants.length) {
    for (const [idx, label] of ["S", "M", "L"].entries()) {
      await prisma.productVariant.create({
        data: {
          branchId,
          productId: products.tshirt.id,
          label,
          sku: `${DEMO_SKU_PREFIX}FASH-TSH-${label}`,
          barcode: `880100100501${idx + 2}`,
          stock: 15,
          priceOverride: label === "L" ? 480 : 450,
          sortOrder: idx,
        },
      });
    }
    await prisma.product.update({ where: { id: products.tshirt.id }, data: { stock: 45 } });
    tshirtVariants = await prisma.productVariant.findMany({
      where: { branchId, productId: products.tshirt.id },
    });
  }

  products.chips = await upsertProduct(branchId, catByName("SNACKS"), {
    name: "Meril Chips 25g",
    nameBn: "মেরিল চিপস",
    sku: `${DEMO_SKU_PREFIX}SNCK-CHIPS`,
    barcode: "8801001006011",
    category: "SNACKS",
    unitPrice: 12,
    price: 20,
    stock: 200,
    vatRate: 0,
  });

  products.flour = await upsertProduct(branchId, catByName("GROCERY"), {
    name: "Baking Flour (Maida) 1kg",
    nameBn: "বেকিং ময়দা ১ কেজি",
    sku: `${DEMO_SKU_PREFIX}MFG-FLOUR`,
    barcode: "8801001007011",
    category: "GROCERY",
    isRawMaterial: true,
    unitPrice: 55,
    price: 65,
    stock: 80,
    vatRate: 0,
    reorderLevel: 20,
  });

  products.sugar = await upsertProduct(branchId, catByName("GROCERY"), {
    name: "Refined Sugar 1kg",
    nameBn: "চini ১ কেজি",
    sku: `${DEMO_SKU_PREFIX}MFG-SUGAR`,
    barcode: "8801001007012",
    category: "GROCERY",
    isRawMaterial: true,
    unitPrice: 72,
    price: 85,
    stock: 60,
    vatRate: 0,
    reorderLevel: 15,
  });

  products.butter = await upsertProduct(branchId, catByName("DAIRY"), {
    name: "Butter / Ghee 500g",
    nameBn: "মাখন / ঘি ৫০০ গ্রাম",
    sku: `${DEMO_SKU_PREFIX}MFG-BUTTER`,
    barcode: "8801001007013",
    category: "DAIRY",
    isRawMaterial: true,
    unitPrice: 320,
    price: 380,
    stock: 40,
    vatRate: 0,
    reorderLevel: 10,
  });

  for (const catName of ["RAW_MATERIAL", "SEMI_FINISHED", "FINISHED_GOODS"]) {
    if (!catByName(catName)) {
      await prisma.productCategory.create({
        data: { branchId, name: catName, department: "MANUFACTURING" },
      });
    }
  }
  const categoriesRefreshed = await prisma.productCategory.findMany({ where: { branchId } });
  const catByNameMfg = (name) => categoriesRefreshed.find((c) => c.name === name)?.id || null;

  products.dough = await upsertProduct(branchId, catByNameMfg("SEMI_FINISHED"), {
    name: "Biscuit Dough Batch",
    nameBn: "বিস্কুট ডো ব্যাচ",
    sku: `${DEMO_SKU_PREFIX}MFG-DOUGH`,
    barcode: "8801001007015",
    category: "SEMI_FINISHED",
    isManufactured: true,
    isRawMaterial: true,
    unitPrice: 0,
    price: 0,
    stock: 0,
    vatRate: 0,
  });

  products.biscuit = await upsertProduct(branchId, catByName("SNACKS"), {
    name: "Homemade Biscuit Pack (24 pcs)",
    nameBn: "হোমমেড বিস্কুট প্যাক (২৪ পিস)",
    sku: `${DEMO_SKU_PREFIX}MFG-BISCUIT`,
    barcode: "8801001007014",
    category: "SNACKS",
    isManufactured: true,
    isRawMaterial: false,
    unitPrice: 0,
    price: 45,
    stock: 0,
    vatRate: 0,
    reorderLevel: 12,
  });

  products.giftBox = await upsertProduct(branchId, catByNameMfg("RAW_MATERIAL"), {
    name: "Gift Box & Wrapper",
    nameBn: "গিফট বক্স ও র‍্যাপার",
    sku: `${DEMO_SKU_PREFIX}MFG-BOX`,
    barcode: "8801001007016",
    category: "RAW_MATERIAL",
    isRawMaterial: true,
    unitPrice: 25,
    price: 35,
    stock: 50,
    vatRate: 0,
  });

  products.giftHamper = await upsertProduct(branchId, catByNameMfg("FINISHED_GOODS"), {
    name: "Biscuit Gift Hamper",
    nameBn: "বিস্কুট গিফট হ্যামপার",
    sku: `${DEMO_SKU_PREFIX}MFG-HAMPER`,
    barcode: "8801001007017",
    category: "FINISHED_GOODS",
    isManufactured: true,
    isRawMaterial: false,
    unitPrice: 0,
    price: 320,
    stock: 0,
    vatRate: 0,
  });

  async function upsertRecipe(finishedProductId, name, yieldQty, lineDefs) {
    let recipe = await prisma.manufacturingRecipe.findFirst({
      where: { branchId, finishedProductId },
    });
    const lineData = lineDefs.map(([rawProductId, qtyRequired], sortOrder) => ({
      rawProductId,
      qtyRequired,
      sortOrder,
    }));
    if (!recipe) {
      recipe = await prisma.manufacturingRecipe.create({
        data: {
          branchId,
          finishedProductId,
          name,
          yieldQty,
          notes: DEMO_NOTE,
          lines: { create: lineData },
        },
      });
    } else {
      await prisma.manufacturingRecipeLine.deleteMany({ where: { recipeId: recipe.id } });
      recipe = await prisma.manufacturingRecipe.update({
        where: { id: recipe.id },
        data: {
          name,
          yieldQty,
          notes: DEMO_NOTE,
          lines: { create: lineData },
        },
      });
    }
    return recipe;
  }

  const doughRecipe = await upsertRecipe(
    products.dough.id,
    `Dough batch ${DEMO_NOTE}`,
    5,
    [
      [products.flour.id, 1.5],
      [products.sugar.id, 0.4],
    ]
  );

  const biscuitRecipe = await upsertRecipe(
    products.biscuit.id,
    `Biscuit batch ${DEMO_NOTE}`,
    24,
    [
      [products.dough.id, 2],
      [products.butter.id, 1],
    ]
  );

  const hamperRecipe = await upsertRecipe(
    products.giftHamper.id,
    `Gift hamper ${DEMO_NOTE}`,
    1,
    [
      [products.biscuit.id, 6],
      [products.giftBox.id, 1],
    ]
  );
  void hamperRecipe;

  await prisma.productionOrder.deleteMany({
    where: { branchId, productionNo: { in: ["DEMO-MFG-DOUGH-001", "DEMO-MFG-001"] } },
  });

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: products.flour.id }, data: { stock: 80 } });
    await tx.product.update({ where: { id: products.sugar.id }, data: { stock: 60 } });
    await tx.product.update({ where: { id: products.butter.id }, data: { stock: 40 } });
    await tx.product.update({ where: { id: products.dough.id }, data: { stock: 0, unitPrice: 0 } });
    await tx.product.update({ where: { id: products.biscuit.id }, data: { stock: 0, unitPrice: 0 } });

    const doughMaterialCost = 1.5 * 55 + 0.4 * 72;
    const doughUnitCost = doughMaterialCost / 5;
    await tx.product.update({ where: { id: products.flour.id }, data: { stock: { decrement: 1.5 } } });
    await tx.product.update({ where: { id: products.sugar.id }, data: { stock: { decrement: 1 } } });
    await tx.product.update({
      where: { id: products.dough.id },
      data: { stock: 5, unitPrice: doughUnitCost },
    });
    await tx.productionOrder.create({
      data: {
        branchId,
        recipeId: doughRecipe.id,
        productionNo: "DEMO-MFG-DOUGH-001",
        batchCount: 1,
        finishedQty: 5,
        status: "COMPLETED",
        notes: DEMO_NOTE,
        consumptionJson: JSON.stringify([
          { rawProductId: products.flour.id, name: products.flour.name, qty: 1.5, unitCost: 55 },
          { rawProductId: products.sugar.id, name: products.sugar.name, qty: 0.4, unitCost: 72 },
        ]),
        createdAt: daysAgo(3),
      },
    });

    const biscuitMaterialCost = 2 * doughUnitCost + 1 * 320;
    const biscuitUnitCost = biscuitMaterialCost / 24;
    await tx.product.update({ where: { id: products.dough.id }, data: { stock: { decrement: 2 } } });
    await tx.product.update({ where: { id: products.butter.id }, data: { stock: { decrement: 1 } } });
    await tx.product.update({
      where: { id: products.biscuit.id },
      data: { stock: 24, unitPrice: biscuitUnitCost },
    });
    await tx.productionOrder.create({
      data: {
        branchId,
        recipeId: biscuitRecipe.id,
        productionNo: "DEMO-MFG-001",
        batchCount: 1,
        finishedQty: 24,
        status: "COMPLETED",
        notes: DEMO_NOTE,
        consumptionJson: JSON.stringify([
          { rawProductId: products.dough.id, name: products.dough.name, qty: 2, unitCost: doughUnitCost },
          { rawProductId: products.butter.id, name: products.butter.name, qty: 1, unitCost: 320 },
        ]),
        createdAt: daysAgo(2),
      },
    });
  });

  const napaBatchExisting = await prisma.inventoryBatch.findFirst({
    where: { branchId, productId: products.napa.id, batchCode: "DEMO-BATCH-NAPA-01" },
  });
  const napaBatch =
    napaBatchExisting ||
    (await prisma.inventoryBatch.create({
      data: {
        branchId,
        productId: products.napa.id,
        batchCode: "DEMO-BATCH-NAPA-01",
        qtyOnHand: 120,
        expiryDate: daysFromNow(90),
      },
    }));
  if (napaBatchExisting) {
    await prisma.inventoryBatch.update({
      where: { id: napaBatchExisting.id },
      data: { qtyOnHand: 120, expiryDate: daysFromNow(90) },
    });
  }

  let supplierPran = await prisma.supplier.findFirst({
    where: { branchId, name: "DEMO Pran-RFL Distributor" },
  });
  if (!supplierPran) {
    supplierPran = await prisma.supplier.create({
      data: {
        branchId,
        name: "DEMO Pran-RFL Distributor",
        phone: "01755667788",
        address: "Tejgaon Industrial Area, Dhaka",
      },
    });
  }

  let supplierAciRow = await prisma.supplier.findFirst({ where: { branchId, name: "DEMO ACI Logistics" } });
  if (!supplierAciRow) {
    supplierAciRow = await prisma.supplier.create({
      data: {
        branchId,
        name: "DEMO ACI Logistics",
        phone: "01766778899",
        address: "Narayanganj Warehouse Hub",
      },
    });
  }
  void supplierAciRow;

  const customerRahim = await upsertCustomer(branchId, {
    name: "Rahim Ahmed",
    phone: "01711111111",
    address: "House 12, Banani, Dhaka",
    district: "Dhaka",
    area: "Banani",
    customerType: "RETAIL",
    balance: 0,
    creditLimit: 10000,
    whatsappOptIn: true,
  });

  const customerKarim = await upsertCustomer(branchId, {
    name: "Karim Traders",
    phone: "01722222222",
    address: "Chawkbazar, Old Dhaka",
    district: "Dhaka",
    customerType: "WHOLESALE",
    companyName: "Karim Traders",
    buyerBin: "000987654-0101",
    priceTier: "WHOLESALE",
    balance: 0,
    creditLimit: 50000,
  });

  const customerFatima = await upsertCustomer(branchId, {
    name: "Fatima Begum",
    phone: "01733333333",
    address: "Mirpur-10, Dhaka",
    district: "Dhaka",
    area: "Mirpur",
    balance: 0,
    storedValueBalance: 500,
  });

  await prisma.couponCode.upsert({
    where: { branchId_code: { branchId, code: "DEMOEID10" } },
    update: { isActive: true, discountType: "PERCENT", discountValue: 10, minBasketAmount: 500 },
    create: {
      branchId,
      code: "DEMOEID10",
      discountType: "PERCENT",
      discountValue: 10,
      minBasketAmount: 500,
      maxRedemptions: 100,
      isActive: true,
      startsAt: daysAgo(7),
      endsAt: daysFromNow(60),
    },
  });

  const promoExists = await prisma.promotionRule.findFirst({
    where: { branchId, name: "DEMO Buy 2 Get 1 Chips" },
  });
  if (!promoExists) {
    await prisma.promotionRule.create({
      data: {
        branchId,
        name: "DEMO Buy 2 Get 1 Chips",
        type: "BOGO",
        productId: products.chips.id,
        buyQty: 2,
        getQty: 1,
        isActive: true,
        startsAt: daysAgo(3),
        endsAt: daysFromNow(30),
      },
    });
  }

  await prisma.giftCard.upsert({
    where: { code: "DEMO-GIFT-1000" },
    update: { balance: 750, status: "ACTIVE", customerId: customerFatima.id },
    create: {
      branchId,
      code: "DEMO-GIFT-1000",
      balance: 750,
      status: "ACTIVE",
      customerId: customerFatima.id,
      expiresAt: daysFromNow(180),
    },
  });

  const tables = [];
  for (let i = 1; i <= 8; i += 1) {
    const code = `DEMO-T${i}`;
    let table = await prisma.restaurantTable.findFirst({ where: { branchId, code } });
    if (!table) {
      table = await prisma.restaurantTable.create({
        data: {
          branchId,
          code,
          name: `Table ${i}`,
          capacity: i <= 4 ? 4 : 6,
          sortOrder: i,
          status: i === 2 ? "OCCUPIED" : i === 5 ? "BILLING" : "FREE",
        },
      });
    }
    tables.push(table);
  }

  const kotItems = [
    { productId: products.biryani.id, name: products.biryani.name, qty: 2, notes: "Less spicy" },
    { productId: products.lassi.id, name: products.lassi.name, qty: 2, notes: "" },
  ];

  if (!(await prisma.kitchenTicket.findFirst({ where: { branchId, ticketNo: "DEMO-KOT-OPEN" } }))) {
    await prisma.kitchenTicket.create({
      data: {
        branchId,
        tableId: tables[1].id,
        ticketNo: "DEMO-KOT-OPEN",
        status: "PREPARING",
        itemsJson: JSON.stringify(kotItems),
        notes: DEMO_NOTE,
      },
    });
    await prisma.kitchenTicket.create({
      data: {
        branchId,
        tableId: null,
        ticketNo: "DEMO-KOT-TAKEAWAY",
        status: "OPEN",
        itemsJson: JSON.stringify([
          { productId: products.tehari.id, name: products.tehari.name, qty: 1, notes: "Extra jhol" },
        ]),
        notes: DEMO_NOTE,
      },
    });
  }

  // Restaurant bills (today) so the Restaurant > Summary tab has live data.
  const seedRestaurantBill = async ({ invoiceNo, serviceMode, table, lines, paymentMethod, due = 0, hour, minute }) => {
    if (await prisma.sale.findFirst({ where: { branchId, invoiceNo } })) return null;
    const subTotal = lines.reduce((s, l) => s + l.qty * Number(l.product.price || 0), 0);
    const total = subTotal;
    const createdAt = new Date();
    createdAt.setHours(hour, minute, 0, 0);
    return prisma.sale.create({
      data: {
        branchId,
        cashierId: cashier.id,
        invoiceNo,
        subTotal,
        vatAmount: 0,
        discount: 0,
        total,
        paidAmount: total - due,
        dueAmount: due,
        paymentMethod,
        fulfillmentType: serviceMode,
        orderSource: "RESTAURANT",
        notes: JSON.stringify({
          note: DEMO_NOTE,
          restaurant: {
            serviceMode,
            tableId: table ? table.id : null,
            tableName: table ? table.name : null,
          },
        }),
        createdAt,
        items: {
          create: lines.map((l) => ({
            productId: l.product.id,
            qty: l.qty,
            price: Number(l.product.price || 0),
            cost: Number(l.product.unitPrice || 0),
          })),
        },
      },
    });
  };

  const restBillSpecs = [
    {
      invoiceNo: "DEMO-INV-R001",
      serviceMode: "DINE_IN",
      table: tables[2],
      paymentMethod: "Cash",
      hour: 12,
      minute: 35,
      lines: [
        { product: products.biryani, qty: 2 },
        { product: products.lassi, qty: 2 },
      ],
    },
    {
      invoiceNo: "DEMO-INV-R002",
      serviceMode: "DINE_IN",
      table: tables[0],
      paymentMethod: "bKash",
      hour: 13,
      minute: 10,
      lines: [
        { product: products.tehari, qty: 3 },
        { product: products.lassi, qty: 1 },
      ],
    },
    {
      invoiceNo: "DEMO-INV-R003",
      serviceMode: "TAKEAWAY",
      table: null,
      paymentMethod: "Cash",
      hour: 13,
      minute: 45,
      lines: [{ product: products.biryani, qty: 1 }],
    },
    {
      invoiceNo: "DEMO-INV-R004",
      serviceMode: "DINE_IN",
      table: tables[3],
      paymentMethod: "Card",
      hour: 14,
      minute: 20,
      lines: [
        { product: products.biryani, qty: 4 },
        { product: products.lassi, qty: 4 },
      ],
    },
    {
      invoiceNo: "DEMO-INV-R005",
      serviceMode: "DINE_IN",
      table: tables[5],
      paymentMethod: "Cash",
      due: 100,
      hour: 15,
      minute: 5,
      lines: [{ product: products.tehari, qty: 2 }],
    },
  ];
  const restBillBySaleNo = {};
  for (const spec of restBillSpecs) {
    const sale = await seedRestaurantBill(spec);
    if (sale) restBillBySaleNo[spec.invoiceNo] = sale;
  }

  // A served KOT linked to a paid bill so the kitchen-status metrics have data.
  const servedBill =
    restBillBySaleNo["DEMO-INV-R001"] ||
    (await prisma.sale.findFirst({ where: { branchId, invoiceNo: "DEMO-INV-R001" } }));
  if (servedBill && !(await prisma.kitchenTicket.findFirst({ where: { branchId, ticketNo: "DEMO-KOT-SERVED" } }))) {
    await prisma.kitchenTicket.create({
      data: {
        branchId,
        tableId: tables[2].id,
        ticketNo: "DEMO-KOT-SERVED",
        status: "SERVED",
        saleId: servedBill.id,
        itemsJson: JSON.stringify([
          { productId: products.biryani.id, name: products.biryani.name, qty: 2, notes: "" },
          { productId: products.lassi.id, name: products.lassi.name, qty: 2, notes: "" },
        ]),
        notes: DEMO_NOTE,
      },
    });
  }

  const cartJson = (lines) =>
    JSON.stringify(
      lines.map((l) => ({
        id: l.productId,
        name: l.name,
        qty: l.qty,
        price: l.price,
      }))
    );

  const pendingOrders = [
    {
      orderNo: "DEMO-ORD-001",
      source: "PHONE",
      customerName: "Nasir Hossain",
      customerPhone: "01844444444",
      deliveryAddress: "Uttara Sector 7, Dhaka",
      district: "Dhaka",
      area: "Uttara",
      deliveryFee: 80,
      paymentMethod: "Cash",
      cartJson: cartJson([
        { productId: products.milk.id, name: products.milk.name, qty: 6, price: products.milk.price },
        { productId: products.salt.id, name: products.salt.name, qty: 2, price: products.salt.price },
      ]),
    },
    {
      orderNo: "DEMO-ORD-002",
      source: "FACEBOOK",
      customerName: "Sadia Islam",
      customerPhone: "01955555555",
      deliveryAddress: "Dhanmondi Road 27, Dhaka",
      district: "Dhaka",
      area: "Dhanmondi",
      deliveryFee: 100,
      courierName: "Pathao",
      paymentMethod: "COD",
      cartJson: cartJson([
        { productId: products.tshirt.id, name: products.tshirt.name, qty: 2, price: 450 },
      ]),
    },
    {
      orderNo: "DEMO-ORD-003",
      source: "WEB_STORE",
      customerName: "Web Customer",
      customerPhone: "01666666666",
      deliveryAddress: "Gulshan 1, Dhaka",
      district: "Dhaka",
      deliveryFee: 120,
      paymentMethod: "bKash",
      cartJson: cartJson([
        { productId: products.phone.id, name: products.phone.name, qty: 1, price: products.phone.price },
      ]),
    },
    {
      orderNo: "DEMO-ORD-004",
      source: "FOODPANDA",
      customerName: "Foodpanda Guest",
      customerPhone: "01577777777",
      deliveryFee: 0,
      paymentMethod: "Cash",
      cartJson: cartJson([
        { productId: products.biryani.id, name: products.biryani.name, qty: 3, price: products.biryani.price },
        { productId: products.lassi.id, name: products.lassi.name, qty: 3, price: products.lassi.price },
      ]),
    },
  ];

  for (const ord of pendingOrders) {
    const exists = await prisma.pendingOrder.findFirst({ where: { branchId, orderNo: ord.orderNo } });
    if (!exists) {
      await prisma.pendingOrder.create({
        data: {
          branchId,
          ...ord,
          status: "PENDING",
          notes: DEMO_NOTE,
          createdById: admin?.id || cashier.id,
        },
      });
    }
  }

  const fbOrder = await prisma.pendingOrder.findFirst({ where: { branchId, orderNo: "DEMO-ORD-002" } });
  if (fbOrder && !(await prisma.courierShipment.findFirst({ where: { branchId, pendingOrderId: fbOrder.id } }))) {
    await prisma.courierShipment.create({
      data: {
        branchId,
        pendingOrderId: fbOrder.id,
        provider: "pathao",
        status: "IN_TRANSIT",
        trackingId: "DEMO-TRK-88421",
        codAmount: 1000,
        recipientName: fbOrder.customerName,
        recipientPhone: fbOrder.customerPhone,
        address: fbOrder.deliveryAddress,
      },
    });
  }

  const prescription = await prisma.prescription.findFirst({
    where: { branchId, prescriptionNo: "DEMO-RX-001" },
  });
  if (!prescription) {
    const rx = await prisma.prescription.create({
      data: {
        branchId,
        prescriptionNo: "DEMO-RX-001",
        patientName: "Kamal Hossain",
        patientPhone: "01812345678",
        doctorName: "Dr. Anisur Rahman",
        customerId: customerRahim.id,
        status: "OPEN",
        notes: DEMO_NOTE,
        createdById: admin?.id || cashier.id,
        lines: {
          create: [
            { productId: products.napa.id, qty: 20, dosageNote: "1+1+1 after food" },
            { productId: products.seclo.id, qty: 14, dosageNote: "1 daily before breakfast" },
          ],
        },
      },
    });
    void rx;
  }

  if (!(await prisma.purchase.findFirst({ where: { branchId, invoiceNo: "DEMO-PUR-001" } }))) {
    const purchaseTotal = 48 * 95 + 50 * 28;
    await prisma.purchase.create({
      data: {
        branchId,
        supplierId: supplierPran.id,
        invoiceNo: "DEMO-PUR-001",
        total: purchaseTotal,
        paidAmount: purchaseTotal,
        dueAmount: 0,
        items: {
          create: [
            { productId: products.milk.id, qty: 48, cost: 95 },
            { productId: products.salt.id, qty: 50, cost: 28 },
          ],
        },
      },
    });
  }

  if (!(await prisma.expense.findFirst({ where: { branchId, description: { contains: DEMO_NOTE } } }))) {
    await prisma.expense.create({
      data: {
        branchId,
        createdBy: admin?.id || cashier.id,
        category: "Rent",
        description: `Shop rent — Gulshan ${DEMO_NOTE}`,
        amount: 45000,
        paymentMethod: "Bank",
        expenseDate: daysAgo(2),
      },
    });
  }

  const closedShift = await prisma.shift.findFirst({
    where: { branchId, varianceReason: { contains: DEMO_NOTE } },
  });
  if (!closedShift) {
    await prisma.shift.create({
      data: {
        branchId,
        userId: cashier.id,
        registerId: register.id,
        openedAt: daysAgo(1),
        closedAt: daysAgo(1),
        openingCash: 5000,
        closingCash: 12450,
        varianceReason: `Balanced ${DEMO_NOTE}`,
        drawerMovements: {
          create: [
            { branchId, userId: cashier.id, type: "IN", amount: 500, reason: "Change float top-up" },
            { branchId, userId: cashier.id, type: "OUT", amount: 200, reason: "Petty cash" },
          ],
        },
      },
    });
  }

  if (!(await prisma.sale.findFirst({ where: { branchId, invoiceNo: invoiceNo(1) } }))) {
    await prisma.$transaction(async (tx) => {
      await createDemoSale(tx, {
        branchId,
        cashierId: cashier.id,
        invoice: invoiceNo(1),
        createdAt: daysAgo(0),
        paymentMethod: "Cash",
        paidAmount: 196,
        items: [
          { productId: products.milk.id, qty: 1, price: 120 },
          { productId: products.chips.id, qty: 2, price: 20 },
          { productId: products.salt.id, qty: 1, price: 38 },
        ],
      });

      await createDemoSale(tx, {
        branchId,
        cashierId: cashier.id,
        customerId: customerKarim.id,
        invoice: invoiceNo(2),
        createdAt: daysAgo(1),
        paymentMethod: "bKash",
        paymentChannel: "TRX8DEMO9921",
        paidAmount: 560,
        items: [
          { productId: products.milk.id, qty: 4, price: 115 },
          { productId: products.salt.id, qty: 2, price: 36 },
        ],
      });

      await createDemoSale(tx, {
        branchId,
        cashierId: cashier.id,
        customerId: customerRahim.id,
        invoice: invoiceNo(3),
        createdAt: daysAgo(2),
        paymentMethod: "Due",
        paidAmount: 500,
        dueAmount: 2500,
        items: [
          { productId: products.phone.id, qty: 1, price: 22999, serialNumber: "DEMO-IMEI-359012345678901" },
        ],
      });

      await createDemoSale(tx, {
        branchId,
        cashierId: cashier.id,
        customerId: customerFatima.id,
        invoice: invoiceNo(4),
        createdAt: daysAgo(3),
        paymentMethod: "Cash",
        paidAmount: 413,
        items: [
          { productId: products.napa.id, qty: 10, price: 3.5 },
          { productId: products.potato.id, weightKg: 2.5, price: 55 },
        ],
        batchLinks: [{ productId: products.napa.id, batchId: napaBatch.id }],
      });

      await createDemoSale(tx, {
        branchId,
        cashierId: cashier.id,
        customerId: customerRahim.id,
        invoice: invoiceNo(5),
        createdAt: daysAgo(1),
        paymentMethod: "COD",
        paidAmount: 0,
        dueAmount: 0,
        fulfillmentType: "DELIVERY",
        deliveryFee: 100,
        deliveryAddress: "Banani, Dhaka",
        deliveryDistrict: "Dhaka",
        deliveryArea: "Banani",
        courierName: "RedX",
        trackingId: "DEMO-TRK-REDX-551",
        orderSource: "INBOX",
        codStatus: "PENDING",
        codExpectedAmount: 680,
        items: [{ productId: products.tehari.id, qty: 2, price: 320 }],
      });

      const mVariant = tshirtVariants.find((v) => v.label === "M");
      await createDemoSale(tx, {
        branchId,
        cashierId: cashier.id,
        invoice: invoiceNo(6),
        createdAt: daysAgo(0),
        paymentMethod: "Rocket",
        paymentChannel: "RKT778899",
        paidAmount: 450,
        items: [{ productId: products.tshirt.id, variantId: mVariant?.id, qty: 1, price: 450 }],
      });
    });
  }

  if (admin && !(await prisma.auditLog.findFirst({
    where: {
      action: "POS_SALES_QUOTE",
      entity: "SalesQuote",
    },
  }))) {
    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "POS_SALES_QUOTE",
        entity: "SalesQuote",
        payload: {
          branchId,
          status: "OPEN",
          quoteNo: "DEMO-QTE-001",
          validUntil: daysFromNow(7).toISOString(),
          note: `Wholesale quote for Karim Traders ${DEMO_NOTE}`,
          draft: {
            cart: [
              { id: products.milk.id, name: products.milk.name, qty: 24, price: 115 },
              { id: products.salt.id, name: products.salt.name, qty: 10, price: 36 },
            ],
            customer: { name: customerKarim.name, phone: customerKarim.phone },
            paymentMethod: "Due",
          },
        },
      },
    });
  }

  await seedExtendedLists(prisma, {
    branchId,
    admin,
    cashier,
    register,
    warehouse,
    products,
    customers: { rahim: customerRahim, karim: customerKarim, fatima: customerFatima },
    suppliers: { pran: supplierPran, aci: supplierAciRow },
    daysAgo,
    daysFromNow,
  });

  return {
    branchId,
    adminEmail: admin?.email || "admin@bdpos.local",
    cashierEmail: cashier.email,
    password: "123456",
    storefrontToken: (await prisma.branch.findUnique({ where: { id: branchId } }))?.storefrontToken,
    demoImei: "DEMO-IMEI-359012345678901",
    couponCode: "DEMOEID10",
    giftCard: "DEMO-GIFT-1000",
  };
}

async function main() {
  const { reset, branchId: branchArg } = parseArgs();
  const branchId = await resolveBranchId(branchArg || 0);

  console.log(`\nBD Smart POS — demo seed (branch ${branchId})`);
  if (reset) {
    await deleteDemoData(branchId);
  }

  const result = await seedDemo(branchId);

  console.log("\n✅ Demo data ready!\n");
  console.log("Login accounts:");
  console.log(`  Admin:   ${result.adminEmail} / ${result.password}`);
  console.log(`  Cashier: ${result.cashierEmail} / ${result.password}`);
  console.log("\nDemo highlights:");
  console.log("  • Grocery, pharmacy, mobile (IMEI), restaurant, fashion variants");
  console.log("  • Manufacturing: flour/sugar → dough → biscuits → gift hamper (multi-level BOM)");
  console.log("  • Customers with baki (Rahim — ৳2,500 due), wholesale Karim, wallet Fatima");
  console.log("  • Order inbox: phone, Facebook, web store, Foodpanda");
  console.log("  • Restaurant: 8 tables, open KOTs + 5 bills today (Summary tab has data)");
  console.log("  • Sales: cash, bKash, Rocket, due, COD delivery, batch/expiry, IMEI warranty");
  console.log("  • All list screens: accounting, cheques, assets, petty cash, cost centers,");
  console.log("    bank import, settlements, approvals, stock count, transfers, returns, webhooks");
  console.log(`  • Coupon: ${result.couponCode} (10% off)  |  Gift card: ${result.giftCard}`);
  console.log(`  • IMEI lookup: ${result.demoImei}`);
  console.log(`  • Storefront token: ${result.storefrontToken?.slice(0, 12)}… (Settings)`);
  console.log("\nRe-run with --reset to wipe and recreate demo records.\n");
}

main()
  .catch((err) => {
    console.error("Demo seed failed:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
