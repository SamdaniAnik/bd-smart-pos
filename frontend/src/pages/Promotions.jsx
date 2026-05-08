import { useEffect, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";

function Promotions() {
  const [tab, setTab] = useState("rules"); // rules | coupons
  const [rows, setRows] = useState([]);
  const [couponRows, setCouponRows] = useState([]);
  const [couponForm, setCouponForm] = useState({
    code: "",
    discountType: "PERCENT",
    discountValue: 10,
    minBasketAmount: 0,
    maxRedemptions: 0,
    startsAt: "",
    endsAt: "",
  });
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    name: "",
    type: "CART_PERCENT",
    productId: "",
    category: "",
    buyQty: 1,
    getQty: 1,
    discountValue: 0,
    minBasketAmount: 0,
    bundleProductIds: [],
  });

  const load = async () => {
    const [promoRes, productRes] = await Promise.all([api.get("/promotions"), api.get("/products")]);
    setRows(promoRes.data || []);
    setProducts(productRes.data || []);
  };

  const loadCoupons = async () => {
    const res = await api.get("/promotions/coupons");
    setCouponRows(res.data || []);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadCoupons();
  }, []);

  const createRule = async (e) => {
    e.preventDefault();
    await api.post("/promotions", {
      ...form,
      productId: form.productId ? Number(form.productId) : null,
      buyQty: Number(form.buyQty || 1),
      getQty: Number(form.getQty || 1),
      discountValue: Number(form.discountValue || 0),
      minBasketAmount: Number(form.minBasketAmount || 0),
      bundleProductIds: Array.isArray(form.bundleProductIds) ? form.bundleProductIds.map((x) => Number(x)) : [],
    });
    setForm({
      name: "",
      type: "CART_PERCENT",
      productId: "",
      category: "",
      buyQty: 1,
      getQty: 1,
      discountValue: 0,
      minBasketAmount: 0,
      bundleProductIds: [],
    });
    load();
  };

  const toggleBundleProduct = (productId) => {
    setForm((f) => {
      const id = Number(productId);
      const exists = f.bundleProductIds.includes(id);
      return {
        ...f,
        bundleProductIds: exists ? f.bundleProductIds.filter((x) => x !== id) : [...f.bundleProductIds, id],
      };
    });
  };

  const toggle = async (row) => {
    await api.put(`/promotions/${row.id}`, { isActive: !row.isActive });
    load();
  };

  const removeRule = async (row) => {
    if (!window.confirm("Delete this promotion?")) return;
    await api.delete(`/promotions/${row.id}`);
    load();
  };

  const createCoupon = async (e) => {
    e.preventDefault();
    await api.post("/promotions/coupons", {
      code: couponForm.code,
      discountType: couponForm.discountType,
      discountValue: Number(couponForm.discountValue || 0),
      minBasketAmount: Number(couponForm.minBasketAmount || 0),
      maxRedemptions: Number(couponForm.maxRedemptions || 0),
      startsAt: couponForm.startsAt ? new Date(couponForm.startsAt).toISOString() : null,
      endsAt: couponForm.endsAt ? new Date(couponForm.endsAt).toISOString() : null,
    });
    setCouponForm({
      code: "",
      discountType: "PERCENT",
      discountValue: 10,
      minBasketAmount: 0,
      maxRedemptions: 0,
      startsAt: "",
      endsAt: "",
    });
    loadCoupons();
  };

  const toggleCoupon = async (row) => {
    await api.put(`/promotions/coupons/${row.id}`, { isActive: !row.isActive });
    loadCoupons();
  };

  const removeCoupon = async (row) => {
    if (!window.confirm(`Delete coupon ${row.code}?`)) return;
    await api.delete(`/promotions/coupons/${row.id}`);
    loadCoupons();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Promotions</div>
          <div className="page-subtitle">Automatic cart rules and checkout coupon codes</div>
        </div>
      </div>
      <div className="pos-tabs">
        <div className="pos-tablist" role="tablist" aria-label="Promotion views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "rules"}
            className={`pos-tab ${tab === "rules" ? "pos-tab-active" : ""}`}
            onClick={() => setTab("rules")}
          >
            Auto rules (BOGO / cart %)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "coupons"}
            className={`pos-tab ${tab === "coupons" ? "pos-tab-active" : ""}`}
            onClick={() => setTab("coupons")}
          >
            Checkout coupon codes
            <span className="pos-tab-badge">{couponRows.length}</span>
          </button>
        </div>
      </div>

      {tab === "coupons" ? (
        <>
          <p className="text-muted" style={{ marginBottom: 12 }}>
            Customers enter these codes at POS. Stacks with tier / loyalty discounts and auto promotion rules like cart %.
          </p>
          <form onSubmit={createCoupon} className="form-grid" style={{ marginBottom: 16 }}>
            <input
              placeholder="Code (SAVE10)"
              value={couponForm.code}
              onChange={(e) => setCouponForm((f) => ({ ...f, code: e.target.value }))}
              required
            />
            <select
              className="form-select-sm"
              value={couponForm.discountType}
              onChange={(e) => setCouponForm((f) => ({ ...f, discountType: e.target.value }))}
            >
              <option value="PERCENT">Percent off basket (before VAT)</option>
              <option value="AMOUNT">Fixed BDT off</option>
            </select>
            <input
              type="number"
              placeholder="Value (% or BDT)"
              value={couponForm.discountValue}
              onChange={(e) => setCouponForm((f) => ({ ...f, discountValue: e.target.value }))}
            />
            <input
              type="number"
              placeholder="Min basket BDT"
              value={couponForm.minBasketAmount}
              onChange={(e) => setCouponForm((f) => ({ ...f, minBasketAmount: Number(e.target.value || 0) }))}
            />
            <input
              type="number"
              placeholder="Max uses (0 = unlimited)"
              value={couponForm.maxRedemptions}
              onChange={(e) => setCouponForm((f) => ({ ...f, maxRedemptions: Number(e.target.value || 0) }))}
            />
            <input
              type="datetime-local"
              value={couponForm.startsAt}
              onChange={(e) => setCouponForm((f) => ({ ...f, startsAt: e.target.value }))}
            />
            <input
              type="datetime-local"
              value={couponForm.endsAt}
              onChange={(e) => setCouponForm((f) => ({ ...f, endsAt: e.target.value }))}
            />
            <button type="submit">Create coupon</button>
          </form>
          <DataTable
            title="Coupon codes"
            rows={couponRows}
            columns={[
              { key: "id", label: "ID" },
              { key: "code", label: "Code" },
              { key: "discountType", label: "Type" },
              { key: "discountValue", label: "Value", render: (v, r) => (r.discountType === "PERCENT" ? `${v}%` : `৳${Number(v || 0).toFixed(2)}`) },
              { key: "minBasketAmount", label: "Min basket", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
              {
                key: "uses",
                label: "Uses",
                render: (_, r) => `${Number(r.redemptionCount || 0)} / ${Number(r.maxRedemptions || 0) === 0 ? "∞" : r.maxRedemptions}`,
              },
              { key: "isActive", label: "Active", render: (v) => (v ? "Yes" : "No") },
              {
                key: "actions",
                label: "",
                render: (_, row) => (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => toggleCoupon(row)}>
                      {row.isActive ? "Disable" : "Enable"}
                    </button>
                    <button type="button" className="btn-danger btn-sm" onClick={() => removeCoupon(row)}>
                      Delete
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </>
      ) : null}

      {tab === "rules" ? (
      <>
      <form onSubmit={createRule} className="form-grid" style={{ marginBottom: 12 }}>
        <input
          placeholder="Promotion name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
        <select className="form-select-sm" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
          <option value="CART_PERCENT">Cart % Off</option>
          <option value="CATEGORY_PERCENT">Category % Off</option>
          <option value="BOGO_PRODUCT">BOGO Product</option>
          <option value="BUNDLE_FIXED">Bundle Fixed Price</option>
          <option value="CATEGORY_BUNDLE_FIXED">Category Bundle Fixed Price</option>
        </select>
        {form.type === "BOGO_PRODUCT" ? (
          <>
            <select className="form-select-sm" value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))} required>
              <option value="">Select product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input type="number" placeholder="Buy Qty" value={form.buyQty} onChange={(e) => setForm((f) => ({ ...f, buyQty: e.target.value }))} />
            <input type="number" placeholder="Get Qty" value={form.getQty} onChange={(e) => setForm((f) => ({ ...f, getQty: e.target.value }))} />
          </>
        ) : null}
        {form.type === "CATEGORY_PERCENT" ? (
          <input
            placeholder="Category text (exact match)"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            required
          />
        ) : null}
        {form.type === "CATEGORY_BUNDLE_FIXED" ? (
          <>
            <input
              placeholder="Category text (exact match)"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              required
            />
            <input
              type="number"
              placeholder="Bundle size (e.g. 2)"
              value={form.buyQty}
              onChange={(e) => setForm((f) => ({ ...f, buyQty: e.target.value }))}
              min={2}
              required
            />
            <input
              type="number"
              placeholder="Fixed bundle price"
              value={form.discountValue}
              onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
              required
            />
          </>
        ) : null}
        {form.type !== "BOGO_PRODUCT" && form.type !== "BUNDLE_FIXED" && form.type !== "CATEGORY_BUNDLE_FIXED" ? (
          <input
            type="number"
            placeholder="Discount %"
            value={form.discountValue}
            onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
          />
        ) : null}
        {form.type === "BUNDLE_FIXED" ? (
          <>
            <input
              type="number"
              placeholder="Bundle fixed price"
              value={form.discountValue}
              onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
              required
            />
            <div className="page-card" style={{ maxHeight: 180, overflow: "auto" }}>
              <strong>Select bundle products (2+)</strong>
              {products.map((p) => (
                <label key={p.id} style={{ display: "block", marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={form.bundleProductIds.includes(Number(p.id))}
                    onChange={() => toggleBundleProduct(p.id)}
                  />{" "}
                  {p.name}
                </label>
              ))}
            </div>
          </>
        ) : null}
        {form.type === "CART_PERCENT" ? (
          <input
            type="number"
            placeholder="Min basket amount"
            value={form.minBasketAmount}
            onChange={(e) => setForm((f) => ({ ...f, minBasketAmount: e.target.value }))}
          />
        ) : null}
        <button type="submit">Create Promotion</button>
      </form>

      <DataTable
        title="Promotion Rules"
        rows={rows}
        columns={[
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "type", label: "Type" },
          { key: "product", label: "Product", render: (_, r) => r.product?.name || "-" },
          { key: "category", label: "Category", render: (v) => v || "-" },
          {
            key: "discountValue",
            label: "Discount",
            render: (v, r) =>
              r.type === "BOGO_PRODUCT" || r.type === "BUNDLE_FIXED" ? "-" : `${Number(v || 0)}%`,
          },
          {
            key: "bundlePrice",
            label: "Bundle Price",
            render: (v, r) =>
              r.type === "BUNDLE_FIXED" || r.type === "CATEGORY_BUNDLE_FIXED"
                ? `৳${Number(v || r.discountValue || 0).toFixed(2)}`
                : "-",
          },
          {
            key: "categoryBundle",
            label: "Category Bundle",
            render: (_, r) =>
              r.type === "CATEGORY_BUNDLE_FIXED"
                ? `${r.category || "-"} | ${Number(r.buyQty || 0)} for ৳${Number(r.bundlePrice || r.discountValue || 0).toFixed(2)}`
                : "-",
          },
          { key: "bundleProductIds", label: "Bundle Products", render: (v, r) => (r.type === "BUNDLE_FIXED" ? String(v || "-") : "-") },
          { key: "buyQty", label: "Buy Qty" },
          { key: "getQty", label: "Get Qty" },
          { key: "minBasketAmount", label: "Min Basket", render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "isActive", label: "Status", render: (v) => (v ? "Active" : "Inactive") },
          {
            key: "actions",
            label: "Actions",
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => toggle(row)}>
                  {row.isActive ? "Disable" : "Enable"}
                </button>
                <button type="button" className="btn-danger btn-sm" onClick={() => removeRule(row)}>
                  Delete
                </button>
              </div>
            ),
          },
        ]}
      />
      </>
      ) : null}
    </div>
  );
}

export default Promotions;
