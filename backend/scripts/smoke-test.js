/* eslint-disable no-console */
const BASE = process.env.API_BASE || "http://127.0.0.1:5001/api";

async function request(path, options = {}) {
  const mergedHeaders = { "content-type": "application/json", ...(options.headers || {}) };
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: mergedHeaders,
  });
  const text = await response.text();
  try {
    return { status: response.status, data: JSON.parse(text) };
  } catch (_error) {
    return { status: response.status, data: text };
  }
}

async function run() {
  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: process.env.SMOKE_EMAIL || "admin@bdpos.local",
      password: process.env.SMOKE_PASSWORD || "123456",
    }),
  });
  if (login.status !== 200) throw new Error(`Login failed: ${JSON.stringify(login.data)}`);
  const token = login.data.token;
  const branchId = String(login.data.user.branchId);
  const auth = { Authorization: `Bearer ${token}`, "x-branch-id": branchId };

  const supplier = await request("/master/suppliers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: `Smoke Supplier ${Date.now()}` }),
  });
  if (supplier.status !== 201) throw new Error(`Supplier failed: ${JSON.stringify(supplier.data)}`);

  const customer = await request("/master/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: `Smoke Customer ${Date.now()}` }),
  });
  if (customer.status !== 201) throw new Error(`Customer failed: ${JSON.stringify(customer.data)}`);

  const product = await request("/products", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: `Smoke Product ${Date.now()}`,
      price: 100,
      stock: 10,
      sku: `SMOKE-${Date.now()}`,
      vatRate: 5,
    }),
  });
  if (product.status !== 201) throw new Error(`Product failed: ${JSON.stringify(product.data)}`);

  const purchase = await request("/purchases", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      supplierId: supplier.data.id,
      paidAmount: 500,
      items: [{ productId: product.data.id, qty: 5, cost: 100 }],
    }),
  });
  if (purchase.status !== 201) throw new Error(`Purchase failed: ${JSON.stringify(purchase.data)}`);

  const sale = await request("/sales/checkout", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      cart: [{ id: product.data.id, qty: 2 }],
      paymentMethod: "Cash",
      paidAmount: 210,
    }),
  });
  if (sale.status !== 200) throw new Error(`Sale failed: ${JSON.stringify(sale.data)}`);

  const invoiceNo = sale.data.sale && sale.data.sale.invoiceNo;
  if (invoiceNo) {
    const lookup = await request(
      `/sales/lookup/by-invoice?invoiceNo=${encodeURIComponent(invoiceNo)}`,
      { headers: auth }
    );
    if (lookup.status !== 200) throw new Error(`Invoice lookup failed: ${JSON.stringify(lookup.data)}`);
    if (Number(lookup.data.saleId) !== Number(sale.data.sale.id)) {
      throw new Error("Invoice lookup returned mismatched saleId");
    }
  }

  const saleReturn = await request(`/sales/${sale.data.sale.id}/return`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      reason: "smoke test",
      items: [{ productId: product.data.id, qty: 1 }],
    }),
  });
  if (saleReturn.status !== 201) throw new Error(`Return failed: ${JSON.stringify(saleReturn.data)}`);

  const trialBalance = await request("/accounting/reports/trial-balance", { headers: auth });
  const stockValuation = await request("/reports/stock-valuation", { headers: auth });

  console.log("Smoke test passed");
  console.log("Trial balance rows:", Array.isArray(trialBalance.data) ? trialBalance.data.length : 0);
  console.log("Stock valuation total:", stockValuation.data.totalValue);
}

run().catch((error) => {
  console.error("Smoke test failed");
  console.error(error.message);
  process.exit(1);
});
