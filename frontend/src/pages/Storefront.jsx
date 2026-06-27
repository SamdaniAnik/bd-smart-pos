import { useCallback, useEffect, useMemo, useState } from "react";
import { BD_DISTRICTS } from "../constants/bdDistricts";
import QrCodeImage from "../components/QrCodeImage";
import {
  createStorefrontApi,
  initiateStorefrontMfs,
  isStorefrontMfsMethod,
  parseStorefrontTable,
  parseStorefrontToken,
  verifyStorefrontMfs,
} from "../services/storefront";
import { getLang, t } from "../i18n";
import { formatBDT } from "../utils/currency";
import { matchesBanglish } from "../utils/banglishSearch";
import SearchSelect from "../components/SearchSelect";

function useStorefrontToken() {
  const read = () => parseStorefrontToken(typeof window !== "undefined" ? window.location.hash : "");
  const [token, setToken] = useState(read);
  useEffect(() => {
    const onChange = () => setToken(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return token;
}

function useStorefrontTable() {
  const read = () => parseStorefrontTable(typeof window !== "undefined" ? window.location.hash : "");
  const [table, setTable] = useState(read);
  useEffect(() => {
    const onChange = () => setTable(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return table;
}

function productLabel(product, lang) {
  if (lang === "bn" && product.nameBn) return product.nameBn;
  return product.name;
}

function matchesSearch(product, query, lang) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  if (product.name.toLowerCase().includes(q)) return true;
  if (product.nameBn && product.nameBn.includes(q)) return true;
  if (product.nameBn && matchesBanglish(q, product.nameBn)) return true;
  if (product.category?.toLowerCase().includes(q)) return true;
  return false;
}

export default function Storefront() {
  const token = useStorefrontToken();
  const tableCode = useStorefrontTable();
  const [lang, setLang] = useState(() => getLang());
  const tt = useCallback((key, params) => t(lang, key, params), [lang]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tableInfo, setTableInfo] = useState(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [cart, setCart] = useState([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderDone, setOrderDone] = useState(null);
  const [variantPick, setVariantPick] = useState(null);

  const [mfsPaymentId, setMfsPaymentId] = useState("");
  const [mfsQrPayload, setMfsQrPayload] = useState("");
  const [mfsPaymentUrl, setMfsPaymentUrl] = useState("");
  const [mfsVerified, setMfsVerified] = useState(false);
  const [mfsBusy, setMfsBusy] = useState(false);
  const [mfsError, setMfsError] = useState("");

  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    district: "Dhaka",
    area: "",
    landmark: "",
    deliveryAddress: "",
    paymentMethod: "COD",
    mfsTrxId: "",
    notes: "",
  });

  const api = useMemo(() => (token ? createStorefrontApi(token) : null), [token]);
  const isRestaurant = String(store?.businessProfile || "").toUpperCase() === "RESTAURANT";
  const isDineIn = Boolean(tableCode);

  const resetMfsSession = useCallback(() => {
    setMfsPaymentId("");
    setMfsQrPayload("");
    setMfsPaymentUrl("");
    setMfsVerified(false);
    setMfsError("");
  }, []);

  useEffect(() => {
    if (!api) {
      setLoading(false);
      setError("missing_token");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const requests = [api.get("/storefront/info"), api.get("/storefront/catalog")];
        if (tableCode) requests.push(api.get("/storefront/tables"));
        const results = await Promise.all(requests);
        if (cancelled) return;
        setStore(results[0].data);
        setProducts(Array.isArray(results[1].data?.products) ? results[1].data.products : []);
        setCategories(Array.isArray(results[1].data?.categories) ? results[1].data.categories : []);
        if (tableCode && results[2]) {
          const tables = Array.isArray(results[2].data?.tables) ? results[2].data.tables : [];
          const match = tables.find((row) => String(row.code) === tableCode);
          setTableInfo(match || { code: tableCode, name: tableCode });
        } else {
          setTableInfo(null);
        }
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.error || err?.message || "load_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, tableCode]);

  useEffect(() => {
    resetMfsSession();
  }, [form.paymentMethod, resetMfsSession]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (category && p.category !== category) return false;
      return matchesSearch(p, search, lang);
    });
  }, [products, category, search, lang]);

  const cartLines = useMemo(() => {
    return cart.map((line) => {
      const product = products.find((p) => p.id === line.productId);
      const variant = product?.variants?.find((v) => v.id === line.variantId);
      const price = variant?.price ?? product?.price ?? 0;
      const name = product ? productLabel(product, lang) : `#${line.productId}`;
      const variantName = variant?.name;
      return { ...line, name, variantName, price, lineTotal: price * line.qty };
    });
  }, [cart, products, lang]);

  const subTotal = cartLines.reduce((s, l) => s + l.lineTotal, 0);
  const deliveryFee = isDineIn ? 0 : form.district === "Dhaka" ? 60 : 120;
  const grandTotal = subTotal + (subTotal > 0 && !isDineIn ? deliveryFee : 0);

  const addToCart = (product, variantId = null) => {
    if (!product.inStock) return;
    if (product.hasVariants && product.variants?.length && !variantId) {
      setVariantPick(product);
      return;
    }
    setCart((prev) => {
      const key = `${product.id}:${variantId || ""}`;
      const existing = prev.find((x) => `${x.productId}:${x.variantId || ""}` === key);
      if (existing) {
        return prev.map((x) =>
          `${x.productId}:${x.variantId || ""}` === key ? { ...x, qty: x.qty + 1 } : x
        );
      }
      return [...prev, { productId: product.id, variantId, qty: 1 }];
    });
    setVariantPick(null);
  };

  const updateQty = (index, delta) => {
    setCart((prev) =>
      prev
        .map((line, i) => (i === index ? { ...line, qty: Math.max(1, line.qty + delta) } : line))
        .filter((line) => line.qty > 0)
    );
  };

  const removeLine = (index) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const startMfsPayment = async () => {
    if (!api || !isStorefrontMfsMethod(form.paymentMethod)) return;
    if (!(grandTotal > 0)) return;
    setMfsBusy(true);
    setMfsError("");
    try {
      const session = await initiateStorefrontMfs(api, {
        method: form.paymentMethod,
        amount: grandTotal,
        invoiceRef: `WEB-${Date.now()}`,
      });
      setMfsPaymentId(session.paymentId || "");
      setMfsQrPayload(session.qrPayload || "");
      setMfsPaymentUrl(session.paymentUrl || "");
      setMfsVerified(false);
    } catch (err) {
      setMfsError(err?.response?.data?.error || err?.message || "mfs_failed");
    } finally {
      setMfsBusy(false);
    }
  };

  const verifyMfsTrx = async () => {
    if (!api || !mfsPaymentId) return;
    const trxId = String(form.mfsTrxId || "").trim();
    if (!trxId) {
      setMfsError(tt("storefrontMfsEnterTrx"));
      return;
    }
    setMfsBusy(true);
    setMfsError("");
    try {
      await verifyStorefrontMfs(api, { paymentId: mfsPaymentId, trxId });
      setMfsVerified(true);
    } catch (err) {
      setMfsVerified(false);
      setMfsError(err?.response?.data?.error || err?.message || "mfs_failed");
    } finally {
      setMfsBusy(false);
    }
  };

  const submitOrder = async (e) => {
    e.preventDefault();
    if (!api || !cart.length) return;
    const customerName = String(form.customerName || "").trim();
    if (customerName.length < 2) return;
    if (isStorefrontMfsMethod(form.paymentMethod) && mfsPaymentId && !mfsVerified) {
      setMfsError(tt("storefrontMfsVerifyFirst"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post("/storefront/order", {
        customerName,
        customerPhone: form.customerPhone?.trim() || null,
        district: isDineIn ? null : form.district || null,
        area: isDineIn ? null : form.area?.trim() || null,
        landmark: form.landmark?.trim() || null,
        deliveryAddress: isDineIn ? null : form.deliveryAddress?.trim() || null,
        deliveryFee: subTotal > 0 && !isDineIn ? deliveryFee : 0,
        paymentMethod: form.paymentMethod,
        orderTotal: grandTotal,
        tableCode: tableCode || null,
        mfsPaymentId: mfsPaymentId || null,
        mfsTrxId: form.mfsTrxId?.trim() || null,
        notes:
          !mfsPaymentId && form.mfsTrxId
            ? [form.notes, `TrxID: ${form.mfsTrxId}`].filter(Boolean).join(" ").trim() || null
            : form.notes?.trim() || null,
        lines: cart.map((line) => ({
          productId: line.productId,
          productVariantId: line.variantId || undefined,
          qty: line.qty,
        })),
      });
      setOrderDone(res.data);
      setCart([]);
      setCheckoutOpen(false);
      resetMfsSession();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "order_failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="storefront-shell">
        <div className="storefront-card">
          <h1>{tt("storefrontTitle")}</h1>
          <p>{tt("storefrontMissingToken")}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="storefront-shell">
        <div className="storefront-card">{tt("storefrontLoading")}</div>
      </div>
    );
  }

  if (error && !store) {
    return (
      <div className="storefront-shell">
        <div className="storefront-card">
          <h1>{tt("storefrontTitle")}</h1>
          <p className="text-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="storefront-shell">
      <header className="storefront-header">
        <div>
          <h1 className="storefront-store-name">{store?.name || tt("storefrontTitle")}</h1>
          {store?.address ? <div className="storefront-meta">{store.address}</div> : null}
          {store?.phone ? <div className="storefront-meta">{store.phone}</div> : null}
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setLang(lang === "bn" ? "en" : "bn")}>
          {lang === "bn" ? "English" : "বাংলা"}
        </button>
      </header>

      {tableCode ? (
        <div className="storefront-table-banner">
          {tt("storefrontTableOrder", {
            table: tableInfo?.name || tableInfo?.code || tableCode,
          })}
          {isRestaurant ? null : (
            <span className="storefront-table-hint"> ({tt("storefrontTableHint")})</span>
          )}
        </div>
      ) : null}

      {orderDone ? (
        <div className="storefront-card storefront-success">
          <h2>{tt("storefrontOrderPlaced")}</h2>
          <p>{tt("storefrontOrderNo", { no: orderDone.orderNo || orderDone.id })}</p>
          <p className="text-muted">{tt("storefrontOrderThanks")}</p>
          <button type="button" className="btn-primary" onClick={() => setOrderDone(null)}>
            {tt("storefrontContinueShopping")}
          </button>
        </div>
      ) : null}

      <div className="storefront-toolbar">
        <input
          className="storefront-search"
          placeholder={tt("storefrontSearchPh")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <SearchSelect
          className="form-select-sm"
          value={category}
          onChange={(val) => setCategory(val)}
          placeholder={tt("storefrontAllCategories")}
          options={categories.map((c) => ({ value: c, label: c }))}
        />
      </div>

      <div className="storefront-grid">
        {filtered.map((product) => (
          <article key={product.id} className={`storefront-product ${product.inStock ? "" : "out-of-stock"}`}>
            <div className="storefront-product-img">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={productLabel(product, lang)} />
              ) : (
                <span>{productLabel(product, lang).slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="storefront-product-body">
              <div className="storefront-product-cat">{product.category}</div>
              <div className="storefront-product-name">{productLabel(product, lang)}</div>
              <div className="storefront-product-price">{formatBDT(product.price, { lang, decimals: 0 })}</div>
              {!product.inStock ? <div className="storefront-badge">{tt("storefrontOutOfStock")}</div> : null}
              <button
                type="button"
                className="btn-primary btn-sm storefront-add-btn"
                disabled={!product.inStock}
                onClick={() => addToCart(product)}
              >
                {tt("storefrontAddToCart")}
              </button>
            </div>
          </article>
        ))}
        {!filtered.length ? <p className="text-muted">{tt("storefrontNoProducts")}</p> : null}
      </div>

      {cart.length > 0 ? (
        <div className="storefront-cart-bar">
          <button type="button" className="btn-primary storefront-cart-btn" onClick={() => setCheckoutOpen(true)}>
            {tt("storefrontViewCart", { count: cart.length, total: formatBDT(grandTotal, { lang, decimals: 0 }) })}
          </button>
        </div>
      ) : null}

      {variantPick ? (
        <div className="storefront-modal-backdrop" onClick={() => setVariantPick(null)}>
          <div className="storefront-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{productLabel(variantPick, lang)}</h3>
            <p className="text-muted">{tt("storefrontPickVariant")}</p>
            <div className="storefront-variant-list">
              {variantPick.variants?.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="btn-secondary"
                  disabled={!v.inStock}
                  onClick={() => addToCart(variantPick, v.id)}
                >
                  {v.name} — {formatBDT(v.price, { lang, decimals: 0 })}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {checkoutOpen ? (
        <div className="storefront-modal-backdrop" onClick={() => !submitting && setCheckoutOpen(false)}>
          <div className="storefront-modal storefront-checkout" onClick={(e) => e.stopPropagation()}>
            <h3>{tt("storefrontCheckout")}</h3>
            <ul className="storefront-cart-list">
              {cartLines.map((line, idx) => (
                <li key={`${line.productId}-${line.variantId || ""}`}>
                  <span>
                    {line.name}
                    {line.variantName ? ` (${line.variantName})` : ""} × {line.qty}
                  </span>
                  <span>
                    {formatBDT(line.lineTotal, { lang, decimals: 0 })}
                    <button type="button" className="btn-ghost btn-sm" onClick={() => updateQty(idx, -1)}>
                      −
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => updateQty(idx, 1)}>
                      +
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => removeLine(idx)}>
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="storefront-totals">
              <div>{tt("storefrontSubtotal")}: {formatBDT(subTotal, { lang, decimals: 0 })}</div>
              {!isDineIn ? (
                <div>{tt("storefrontDelivery")}: {formatBDT(deliveryFee, { lang, decimals: 0 })}</div>
              ) : null}
              <strong>{tt("storefrontTotal")}: {formatBDT(grandTotal, { lang, decimals: 0 })}</strong>
            </div>
            <form className="form-grid" onSubmit={submitOrder}>
              <input
                required
                placeholder={tt("storefrontPhName")}
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              />
              <input
                placeholder={tt("storefrontPhPhone")}
                value={form.customerPhone}
                onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
              />
              {!isDineIn ? (
                <>
                  <SearchSelect
                    value={form.district}
                    onChange={(val) => setForm({ ...form, district: val || BD_DISTRICTS[0] })}
                    options={BD_DISTRICTS.map((d) => ({ value: d, label: d }))}
                    isClearable={false}
                  />
                  <input
                    placeholder={tt("storefrontPhArea")}
                    value={form.area}
                    onChange={(e) => setForm({ ...form, area: e.target.value })}
                  />
                  <input
                    placeholder={tt("storefrontPhAddress")}
                    value={form.deliveryAddress}
                    onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
                  />
                </>
              ) : null}
              <SearchSelect
                value={form.paymentMethod}
                onChange={(val) => setForm({ ...form, paymentMethod: val || "COD", mfsTrxId: "" })}
                options={[
                  { value: "COD", label: tt("storefrontPayCod") },
                  { value: "bKash", label: tt("storefrontPayBkash") },
                  { value: "Nagad", label: tt("storefrontPayNagad") },
                  { value: "Rocket", label: tt("storefrontPayRocket") },
                ]}
                isClearable={false}
              />

              {isStorefrontMfsMethod(form.paymentMethod) ? (
                <div className="storefront-mfs-panel">
                  <div className="storefront-mfs-actions">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={mfsBusy || !(grandTotal > 0)}
                      onClick={startMfsPayment}
                    >
                      {mfsBusy ? "…" : tt("storefrontMfsShowQr")}
                    </button>
                    {mfsVerified ? (
                      <span className="storefront-mfs-verified">{tt("storefrontMfsVerified")}</span>
                    ) : null}
                  </div>
                  {mfsQrPayload ? (
                    <div className="storefront-mfs-qr">
                      <QrCodeImage value={mfsQrPayload} size={160} alt={tt("storefrontMfsQrAlt")} />
                      {mfsPaymentUrl ? (
                        <a
                          className="storefront-mfs-link"
                          href={mfsPaymentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {tt("storefrontMfsOpenApp", { method: form.paymentMethod })}
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="storefront-mfs-trx">
                    <input
                      placeholder={tt("storefrontPhTrxId")}
                      value={form.mfsTrxId}
                      onChange={(e) => {
                        setForm({ ...form, mfsTrxId: e.target.value });
                        setMfsVerified(false);
                      }}
                    />
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={mfsBusy || !mfsPaymentId}
                      onClick={verifyMfsTrx}
                    >
                      {tt("storefrontMfsVerify")}
                    </button>
                  </div>
                  <p className="text-muted storefront-mfs-help">{tt("storefrontMfsHelp")}</p>
                  {mfsError ? <p className="storefront-mfs-error">{mfsError}</p> : null}
                </div>
              ) : null}

              <textarea
                placeholder={tt("storefrontPhNotes")}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
              <button type="submit" className="btn-primary" disabled={submitting || !cart.length}>
                {submitting ? "…" : tt("storefrontPlaceOrder")}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
