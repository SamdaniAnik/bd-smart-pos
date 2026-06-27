import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import { getLang, t } from "../i18n";
import { notifyActionRequired, notifyPermissionRequired, notifySuccess } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import SearchSelect from "../components/SearchSelect";

const EMPTY_PROMO_FORM = {
  name: "",
  type: "CART_PERCENT",
  productId: "",
  category: "",
  buyQty: 1,
  getQty: 1,
  discountValue: 0,
  minBasketAmount: 0,
  bundleProductIds: [],
  startsAt: "",
  endsAt: "",
};

const GROCERY_PROMO_CATEGORIES = ["DAIRY", "BEVERAGES", "SNACKS", "FROZEN", "HOUSEHOLD", "PERSONAL_CARE", "GROCERY"];

function formatPromoScheduleLabel(row, tt) {
  const now = Date.now();
  const start = row.startsAt ? new Date(row.startsAt).getTime() : null;
  const end = row.endsAt ? new Date(row.endsAt).getTime() : null;
  if (!row.isActive) return tt("promoStatusInactive");
  if (start && start > now) return tt("promoStatusScheduled");
  if (end && end < now) return tt("promoStatusExpired");
  return tt("promoStatusActive");
}

function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildPromoTemplates(tt) {
  return [
    {
      id: "two_for_99_snacks",
      label: tt("promoTemplate2for99"),
      form: {
        ...EMPTY_PROMO_FORM,
        name: "2 for ৳99 — SNACKS",
        type: "CATEGORY_BUNDLE_FIXED",
        category: "SNACKS",
        buyQty: 2,
        getQty: 1,
        discountValue: 99,
      },
    },
    {
      id: "three_for_150_snacks",
      label: tt("promoTemplate3for150"),
      form: {
        ...EMPTY_PROMO_FORM,
        name: "3 for ৳150 — SNACKS",
        type: "CATEGORY_BUNDLE_FIXED",
        category: "SNACKS",
        buyQty: 3,
        getQty: 1,
        discountValue: 150,
      },
    },
    {
      id: "dairy_10pct",
      label: tt("promoTemplateDairy10"),
      form: {
        ...EMPTY_PROMO_FORM,
        name: "10% off — DAIRY",
        type: "CATEGORY_PERCENT",
        category: "DAIRY",
        discountValue: 10,
      },
    },
    {
      id: "spend_500_5pct",
      label: tt("promoTemplateSpend500"),
      form: {
        ...EMPTY_PROMO_FORM,
        name: "5% off when spend ৳500+",
        type: "CART_PERCENT",
        discountValue: 5,
        minBasketAmount: 500,
      },
    },
    {
      id: "bogo_buy2get1",
      label: "Buy 2 Get 1 (product)",
      form: {
        ...EMPTY_PROMO_FORM,
        name: "Buy 2 Get 1",
        type: "BOGO_PRODUCT",
        buyQty: 2,
        getQty: 1,
      },
    },
    {
      id: "mix_match_snacks",
      label: tt("promoTemplateMixMatch"),
      form: {
        ...EMPTY_PROMO_FORM,
        name: "Mix & match — SNACKS",
        type: "MIX_MATCH_FIXED",
        buyQty: 3,
        discountValue: 120,
        bundleProductIds: [],
      },
    },
  ];
}

function buildFestivalTemplates(tt) {
  return [
    {
      id: "festival_eid",
      label: tt("promoTemplateEid"),
      form: {
        ...EMPTY_PROMO_FORM,
        name: "ঈদ অফার — Eid Offer",
        type: "CART_PERCENT",
        discountValue: 10,
        minBasketAmount: 1000,
      },
    },
    {
      id: "festival_ramadan",
      label: tt("promoTemplateRamadan"),
      form: {
        ...EMPTY_PROMO_FORM,
        name: "রমজান অফার — Ramadan Grocery",
        type: "CATEGORY_PERCENT",
        category: "GROCERY",
        discountValue: 5,
      },
    },
    {
      id: "festival_boishakh",
      label: tt("promoTemplateBoishakh"),
      form: {
        ...EMPTY_PROMO_FORM,
        name: "পহেলা বৈশাখ অফার — Boishakh Offer",
        type: "CART_PERCENT",
        discountValue: 5,
        minBasketAmount: 500,
      },
    },
    {
      id: "festival_puja",
      label: tt("promoTemplatePuja"),
      form: {
        ...EMPTY_PROMO_FORM,
        name: "পূজা অফার — Puja Offer",
        type: "CART_PERCENT",
        discountValue: 8,
      },
    },
    {
      id: "salary_week",
      label: tt("promoTemplateSalaryWeek"),
      form: {
        ...EMPTY_PROMO_FORM,
        name: "বেতন সপ্তাহ — Salary Week",
        type: "CART_PERCENT",
        discountValue: 5,
        minBasketAmount: 2000,
      },
    },
  ];
}

function Promotions() {
  const lang = getLang();
  const tt = (key, params) => t(lang, key, params);
  const { hasPermission } = usePermissions();
  const canManagePromos = hasPermission("product.create");

  const requirePromoCreate = () => {
    if (canManagePromos) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "product.create" }));
    return false;
  };

  const promoTemplates = buildPromoTemplates(tt);
  const festivalTemplates = buildFestivalTemplates(tt);
  const [festivalHint, setFestivalHint] = useState(false);
  const [festivalApiTemplates, setFestivalApiTemplates] = useState([]);
  const [deployingKit, setDeployingKit] = useState("");
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
  const [form, setForm] = useState({ ...EMPTY_PROMO_FORM });
  const [productCategories, setProductCategories] = useState([]);
  const [showExpiryAutoOnly, setShowExpiryAutoOnly] = useState(() => {
    try {
      return sessionStorage.getItem("bd_pos_promotions_filter") === "expiry_auto";
    } catch {
      return false;
    }
  });

  const load = async () => {
    const [promoRes, productRes, catRes] = await Promise.all([
      api.get("/promotions"),
      api.get("/products"),
      api.get("/master/product-categories").catch(() => ({ data: [] })),
    ]);
    setRows(promoRes.data || []);
    setProducts(productRes.data || []);
    setProductCategories(Array.isArray(catRes.data) ? catRes.data : []);
  };

  const categoryOptions = useMemo(() => {
    const fromMaster = productCategories
      .map((c) => String(c.name || "").trim().toUpperCase())
      .filter(Boolean);
    const merged = [...new Set([...GROCERY_PROMO_CATEGORIES, ...fromMaster])].sort();
    return merged;
  }, [productCategories]);

  const loadCoupons = async () => {
    const res = await api.get("/promotions/coupons");
    setCouponRows(res.data || []);
  };

  const deployFestivalKit = async (templateId) => {
    if (!requirePromoCreate()) return;
    const tpl = festivalApiTemplates.find((t) => t.id === templateId) || {};
    setDeployingKit(templateId);
    try {
      await api.post(`/promotions/festival-kits/${templateId}/deploy`, {
        startsAt: tpl.suggestedStartsAt || null,
        endsAt: tpl.suggestedEndsAt || null,
      });
      await load();
      notifySuccess(tt("promoFestivalDeployed"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("promoFestivalDeployFailed"));
    } finally {
      setDeployingKit("");
    }
  };

  useEffect(() => {
    load();
    api.get("/promotions/festival-templates").then((res) => {
      setFestivalApiTemplates(Array.isArray(res.data) ? res.data : []);
    }).catch(() => setFestivalApiTemplates([]));
  }, []);

  useEffect(() => {
    const onNav = (event) => {
      if (event?.detail?.view !== "promotions") return;
      try {
        if (sessionStorage.getItem("bd_pos_promotions_filter") === "expiry_auto") {
          setShowExpiryAutoOnly(true);
          sessionStorage.removeItem("bd_pos_promotions_filter");
          void load();
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("bd_pos_navigate", onNav);
    return () => window.removeEventListener("bd_pos_navigate", onNav);
  }, []);

  const displayRows = useMemo(() => {
    if (!showExpiryAutoOnly) return rows;
    return rows.filter((r) => String(r.name || "").includes("[AUTO] Expiry"));
  }, [rows, showExpiryAutoOnly]);

  useEffect(() => {
    loadCoupons();
  }, []);

  const createRule = async (e) => {
    e.preventDefault();
    if (!requirePromoCreate()) return;
    await api.post("/promotions", {
      ...form,
      productId: form.productId ? Number(form.productId) : null,
      buyQty: Number(form.buyQty || 1),
      getQty: Number(form.getQty || 1),
      discountValue: Number(form.discountValue || 0),
      minBasketAmount: Number(form.minBasketAmount || 0),
      bundleProductIds: Array.isArray(form.bundleProductIds) ? form.bundleProductIds.map((x) => Number(x)) : [],
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
    });
    setForm({ ...EMPTY_PROMO_FORM });
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
    if (!requirePromoCreate()) return;
    await api.put(`/promotions/${row.id}`, { isActive: !row.isActive });
    load();
  };

  const removeRule = async (row) => {
    if (!requirePromoCreate()) return;
    if (!window.confirm("Delete this promotion?")) return;
    await api.delete(`/promotions/${row.id}`);
    load();
  };

  const createCoupon = async (e) => {
    e.preventDefault();
    if (!requirePromoCreate()) return;
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
    if (!requirePromoCreate()) return;
    await api.put(`/promotions/coupons/${row.id}`, { isActive: !row.isActive });
    loadCoupons();
  };

  const removeCoupon = async (row) => {
    if (!requirePromoCreate()) return;
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
      <PermissionBanner show={!canManagePromos} code="product.create" tt={tt} />
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
            <SearchSelect
              className="form-select-sm"
              value={couponForm.discountType}
              onChange={(val) => setCouponForm((f) => ({ ...f, discountType: val || "PERCENT" }))}
              options={[
                { value: "PERCENT", label: "Percent off basket (before VAT)" },
                { value: "AMOUNT", label: "Fixed BDT off" },
              ]}
              isClearable={false}
            />
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
            <button type="submit" disabled={!canManagePromos}>Create coupon</button>
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
      <div className="pos-department-chips" style={{ marginBottom: 12 }} role="group" aria-label={tt("promoTemplatesLabel")}>
        <span className="pos-quick-add-label" style={{ alignSelf: "center" }}>
          {tt("promoTemplatesLabel")}:
        </span>
        {promoTemplates.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className="pos-dept-chip"
            onClick={() => {
              setForm({ ...tpl.form });
              setFestivalHint(false);
            }}
            title={tpl.form.type === "BOGO_PRODUCT" ? tt("promoTemplateBogoHint") : undefined}
          >
            {tpl.label}
          </button>
        ))}
      </div>
      <div
        className="pos-department-chips"
        style={{ marginBottom: 12 }}
        role="group"
        aria-label={tt("promoFestivalTemplatesLabel")}
      >
        <span className="pos-quick-add-label" style={{ alignSelf: "center" }}>
          {tt("promoFestivalTemplatesLabel")}:
        </span>
        {festivalTemplates.map((tpl) => (
          <span key={tpl.id} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <button
              type="button"
              className="pos-dept-chip"
              onClick={() => {
                setForm({ ...tpl.form });
                setFestivalHint(true);
              }}
            >
              {tpl.label}
            </button>
            {canManagePromos ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={deployingKit === tpl.id}
                onClick={() => deployFestivalKit(tpl.id)}
                title={tt("promoFestivalDeployHint")}
              >
                {deployingKit === tpl.id ? "…" : tt("promoFestivalDeploy")}
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {festivalHint ? (
        <p className="text-muted" style={{ marginTop: -6, marginBottom: 10, fontSize: 13 }}>
          {tt("promoFestivalDateHint")}
        </p>
      ) : null}
      <form onSubmit={createRule} className="form-grid" style={{ marginBottom: 12 }}>
        <input
          placeholder="Promotion name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
        <SearchSelect
          className="form-select-sm"
          value={form.type}
          onChange={(val) => setForm((f) => ({ ...f, type: val || "CART_PERCENT" }))}
          options={[
            { value: "CART_PERCENT", label: "Cart % Off" },
            { value: "CATEGORY_PERCENT", label: "Category % Off" },
            { value: "BOGO_PRODUCT", label: "BOGO Product" },
            { value: "BUNDLE_FIXED", label: "Bundle Fixed Price" },
            { value: "CATEGORY_BUNDLE_FIXED", label: "Category Bundle Fixed Price" },
            { value: "MIX_MATCH_FIXED", label: tt("promoTypeMixMatch") },
          ]}
          isClearable={false}
        />
        {form.type === "BOGO_PRODUCT" ? (
          <>
            <SearchSelect
              className="form-select-sm"
              value={form.productId}
              onChange={(val) => setForm((f) => ({ ...f, productId: val }))}
              placeholder="Select product"
              options={products.map((p) => ({ value: String(p.id), label: p.name }))}
            />
            <input type="number" placeholder="Buy Qty" value={form.buyQty} onChange={(e) => setForm((f) => ({ ...f, buyQty: e.target.value }))} />
            <input type="number" placeholder="Get Qty" value={form.getQty} onChange={(e) => setForm((f) => ({ ...f, getQty: e.target.value }))} />
          </>
        ) : null}
        {form.type === "CATEGORY_PERCENT" ? (
          <SearchSelect
            className="form-select-sm"
            value={form.category}
            onChange={(val) => setForm((f) => ({ ...f, category: val }))}
            placeholder={tt("promoPickCategory")}
            options={categoryOptions.map((cat) => ({ value: cat, label: cat }))}
          />
        ) : null}
        {form.type === "CATEGORY_BUNDLE_FIXED" ? (
          <>
            <SearchSelect
              className="form-select-sm"
              value={form.category}
              onChange={(val) => setForm((f) => ({ ...f, category: val }))}
              placeholder={tt("promoPickCategory")}
              options={categoryOptions.map((cat) => ({ value: cat, label: cat }))}
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
        {form.type === "MIX_MATCH_FIXED" ? (
          <>
            <input
              type="number"
              placeholder={tt("promoMixPickCount")}
              value={form.buyQty}
              onChange={(e) => setForm((f) => ({ ...f, buyQty: e.target.value }))}
              min={2}
              required
            />
            <input
              type="number"
              placeholder={tt("promoMixBundlePrice")}
              value={form.discountValue}
              onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
              required
            />
            <div className="page-card" style={{ maxHeight: 180, overflow: "auto" }}>
              <strong>{tt("promoMixPickProducts")}</strong>
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
        {form.type !== "BOGO_PRODUCT" &&
        form.type !== "BUNDLE_FIXED" &&
        form.type !== "CATEGORY_BUNDLE_FIXED" &&
        form.type !== "MIX_MATCH_FIXED" ? (
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
        <input
          type="datetime-local"
          value={form.startsAt}
          onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
          title={tt("promoStartsAt")}
        />
        <input
          type="datetime-local"
          value={form.endsAt}
          onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
          title={tt("promoEndsAt")}
        />
        <button type="submit" disabled={!canManagePromos}>Create Promotion</button>
      </form>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <button
          type="button"
          className={`pos-dept-chip${showExpiryAutoOnly ? " active" : ""}`}
          onClick={() => setShowExpiryAutoOnly((v) => !v)}
        >
          {tt("promoFilterExpiryAuto")}
        </button>
        {showExpiryAutoOnly ? (
          <span className="text-muted" style={{ fontSize: 13 }}>
            {tt("promoFilterExpiryAutoCount", { n: displayRows.length })}
          </span>
        ) : null}
      </div>
      <DataTable
        title="Promotion Rules"
        rows={displayRows}
        columns={[
          { key: "id", label: "ID" },
          { key: "name", label: "Name" },
          { key: "type", label: "Type" },
          { key: "product", label: "Product", render: (_, r) => r.product?.name || "-" },
          { key: "category", label: "Category", render: (v) => v || "-" },
          {
            key: "schedule",
            label: tt("promoColSchedule"),
            render: (_, r) => formatPromoScheduleLabel(r, tt),
          },
          {
            key: "startsAt",
            label: tt("promoStartsAt"),
            render: (v) => (v ? new Date(v).toLocaleString() : "—"),
          },
          {
            key: "endsAt",
            label: tt("promoEndsAt"),
            render: (v) => (v ? new Date(v).toLocaleString() : "—"),
          },
          {
            key: "discountValue",
            label: "Discount",
            render: (v, r) =>
              r.type === "BOGO_PRODUCT" ||
              r.type === "BUNDLE_FIXED" ||
              r.type === "CATEGORY_BUNDLE_FIXED" ||
              r.type === "MIX_MATCH_FIXED"
                ? "-"
                : `${Number(v || 0)}%`,
          },
          {
            key: "bundlePrice",
            label: "Bundle Price",
            render: (v, r) =>
              r.type === "BUNDLE_FIXED" || r.type === "CATEGORY_BUNDLE_FIXED" || r.type === "MIX_MATCH_FIXED"
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
          {
            key: "mixMatch",
            label: tt("promoTypeMixMatch"),
            render: (_, r) =>
              r.type === "MIX_MATCH_FIXED"
                ? `${Number(r.buyQty || 0)} for ৳${Number(r.bundlePrice || r.discountValue || 0).toFixed(2)} | ${String(r.bundleProductIds || "-")}`
                : "-",
          },
          {
            key: "bundleProductIds",
            label: "Bundle Products",
            render: (v, r) => (r.type === "BUNDLE_FIXED" || r.type === "MIX_MATCH_FIXED" ? String(v || "-") : "-"),
          },
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
