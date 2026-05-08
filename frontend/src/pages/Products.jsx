import { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import api from "../services/api";
import DataTable from "../components/DataTable";
import JsBarcode from "jsbarcode";
import { notifyActionRequired } from "../utils/notify";
import { createSearchSelectStyles } from "../utils/selectStyles";
import { getLang, t } from "../i18n";

const SEARCH_SELECT_STYLES = createSearchSelectStyles(38);

function Products() {
  const [uiLang, setUiLang] = useState(() => getLang());
  useEffect(() => {
    const sync = () => setUiLang(getLang());
    window.addEventListener("bd_pos_lang_changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("bd_pos_lang_changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const tt = useMemo(() => (key, params) => t(uiLang, key, params), [uiLang]);

  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    name: "",
    price: "",
    stock: "",
    category: "",
    sku: "",
    vatRate: "",
    reorderLevel: "",
    defaultDiscountType: "",
    defaultDiscountValue: "",
    batchTracked: false,
    sellByWeight: false,
    stockKg: "",
    hasVariants: false,
  });
  const [variantDraft, setVariantDraft] = useState({
    label: "",
    sku: "",
    barcode: "",
    stock: "0",
    priceOverride: "",
  });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [labelQtyByProduct, setLabelQtyByProduct] = useState({});
  const [labelSize, setLabelSize] = useState("50x30");
  const [bulkLabelQty, setBulkLabelQty] = useState(1);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkLowStockOnly, setBulkLowStockOnly] = useState(false);
  const [sheetTemplate, setSheetTemplate] = useState("free");
  const [productsTab, setProductsTab] = useState("form");

  const selectedLabelProducts = useMemo(
    () => products.filter((p) => Number(labelQtyByProduct[p.id] || 0) > 0),
    [products, labelQtyByProduct]
  );

  const categories = useMemo(
    () => [...new Set(products.map((p) => String(p.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [products]
  );

  const fetchProducts = async () => {
    const res = await api.get("/products?include=variants");
    setProducts(res.data);
  };

  const refreshSelectedProduct = async (id) => {
    if (!id) return;
    const res = await api.get(`/products/${id}`);
    setSelected(res.data);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchProducts();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = {
      name: form.name,
      price: Number(form.price),
      stock: Number(form.stock),
      category: form.category,
      sku: form.sku || null,
      vatRate: Number(form.vatRate || 0),
      reorderLevel: Number(form.reorderLevel || 0),
      defaultDiscountType: form.defaultDiscountType || null,
      defaultDiscountValue: Number(form.defaultDiscountValue || 0),
      batchTracked: Boolean(form.batchTracked),
      sellByWeight: Boolean(form.sellByWeight),
      stockKg: Number(form.stockKg || 0),
      hasVariants: Boolean(form.hasVariants),
    };

    if (editingId) {
      await api.put(`/products/${editingId}`, payload);
    } else {
      await api.post("/products", payload);
    }

    setForm({
      name: "",
      price: "",
      stock: "",
      category: "",
      sku: "",
      vatRate: "",
      reorderLevel: "",
      defaultDiscountType: "",
      defaultDiscountValue: "",
      batchTracked: false,
      sellByWeight: false,
      stockKg: "",
      hasVariants: false,
    });
    setEditingId(null);
    setSelected(null);

    fetchProducts();
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setSelected(row);
    setForm({
      name: row.name || "",
      price: row.price ?? "",
      stock: row.stock ?? "",
      category: row.category || "",
      sku: row.sku || "",
      vatRate: row.vatRate ?? "",
      reorderLevel: row.reorderLevel ?? "",
      defaultDiscountType: row.defaultDiscountType || "",
      defaultDiscountValue: row.defaultDiscountValue ?? "",
      batchTracked: Boolean(row.batchTracked),
      sellByWeight: Boolean(row.sellByWeight),
      stockKg: row.stockKg ?? "",
      hasVariants: Boolean(row.hasVariants),
    });
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/products/${row.id}`);
    setSelected(res.data);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setForm({
      name: "",
      price: "",
      stock: "",
      category: "",
      sku: "",
      vatRate: "",
      reorderLevel: "",
      defaultDiscountType: "",
      defaultDiscountValue: "",
      batchTracked: false,
      sellByWeight: false,
      stockKg: "",
      hasVariants: false,
    });
  };

  const handleDelete = async (row) => {
    if (!window.confirm(tt("prodConfirmDeleteProduct", { name: row.name }))) return;
    await api.delete(`/products/${row.id}`);
    if (selected?.id === row.id) setSelected(null);
    if (editingId === row.id) handleCancelEdit();
    fetchProducts();
  };

  const setLabelQty = (productId, qty) => {
    const safeQty = Math.max(0, Math.floor(Number(qty || 0)));
    setLabelQtyByProduct((prev) => ({
      ...prev,
      [productId]: safeQty,
    }));
  };

  const createBarcodeSvg = (value) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, String(value || ""), {
      format: "CODE128",
      width: 1.5,
      height: 36,
      displayValue: false,
      margin: 0,
    });
    return svg.outerHTML;
  };

  const printLabels = () => {
    if (!selectedLabelProducts.length) {
      notifyActionRequired(tt("prodNotifyNeedLabelQty"));
      return;
    }
    const [labelW, labelH] = labelSize.split("x").map((x) => Number(x));
    const templateMap = {
      free: { cols: 0, rows: 0 },
      a4_3x8: { cols: 3, rows: 8 },
      a4_4x10: { cols: 4, rows: 10 },
    };
    const selectedTemplate = templateMap[sheetTemplate] || templateMap.free;
    const maxPerSheet = selectedTemplate.cols && selectedTemplate.rows ? selectedTemplate.cols * selectedTemplate.rows : 0;
    const escapeLabel = (s) =>
      String(s || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const labelHtml = selectedLabelProducts
      .flatMap((row) => {
        const qty = Number(labelQtyByProduct[row.id] || 0);
        const variantRows =
          row.hasVariants && Array.isArray(row.variants) && row.variants.length ? row.variants : null;

        const makeSlices = (name, metaCode, unitPrice, codeForBarcode) => {
          const barcodeSvg = createBarcodeSvg(codeForBarcode);
          return Array.from({ length: qty }).map(
            (_, idx) => `
          <div class="label">
            <div class="name">${escapeLabel(name)}</div>
            <div class="barcode">${barcodeSvg}</div>
            <div class="meta">${escapeLabel(metaCode)}</div>
            <div class="price">৳${Number(unitPrice || 0).toFixed(2)}</div>
            <div class="pack">${tt("prodLabelUnitPack", { cur: idx + 1, total: qty })}</div>
          </div>
        `
          );
        };

        if (variantRows) {
          return variantRows.flatMap((v) => {
            const code =
              String(v.barcode || v.sku || "").trim() || `V-${v.id}`;
            const lbl = `${row.name}${String(v.label || "").trim() ? ` (${String(v.label).trim()})` : ""}`;
            const unit =
              v.priceOverride != null && v.priceOverride !== ""
                ? Number(v.priceOverride)
                : Number(row.price || 0);
            return makeSlices(lbl, code, unit, code);
          });
        }

        const code = row.sku || `P-${row.id}`;
        return makeSlices(row.name, code, row.price || 0, code);
      })
      .join("");
    const sheetClass =
      selectedTemplate.cols && selectedTemplate.rows
        ? `template-grid template-${selectedTemplate.cols}x${selectedTemplate.rows}`
        : "free-grid";
    const cappedHtml = maxPerSheet > 0 ? labelHtml.split("</div>").slice(0, maxPerSheet).join("</div>") : labelHtml;
    const html = `
      <html>
        <head>
          <title>${tt("prodPrintWindowTitle")}</title>
          <style>
            @page { margin: 8mm; }
            body { font-family: Arial, sans-serif; }
            .free-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(${labelW}mm, 1fr)); gap: 2mm; }
            .template-grid { display: grid; gap: 2mm; }
            .template-3x8 { grid-template-columns: repeat(3, ${labelW}mm); }
            .template-4x10 { grid-template-columns: repeat(4, ${labelW}mm); }
            .label { width: ${labelW}mm; height: ${labelH}mm; border: 1px solid #ccc; box-sizing: border-box; padding: 1.5mm; display: flex; flex-direction: column; justify-content: space-between; }
            .name { font-size: 10px; font-weight: 700; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .barcode { height: 10mm; display: flex; align-items: center; }
            .barcode svg { width: 100%; height: 100%; }
            .meta { font-size: 9px; }
            .price { font-size: 10px; font-weight: 700; }
            .pack { font-size: 8px; color: #64748b; }
          </style>
        </head>
        <body>
          <div class="${sheetClass}">${cappedHtml}</div>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `;
    const w = window.open("", "_blank", "width=1024,height=768");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  };

  const applyBulkSelection = () => {
    const qty = Math.max(1, Math.floor(Number(bulkLabelQty || 1)));
    const matched = products.filter((row) => {
      const categoryOk = !bulkCategory || String(row.category || "").trim() === bulkCategory;
      const lowStockOk = !bulkLowStockOnly || Number(row.stock || 0) <= Number(row.reorderLevel || 0);
      return categoryOk && lowStockOk;
    });
    if (!matched.length) {
      notifyActionRequired(tt("prodNotifyBulkNoMatch"));
      return;
    }
    setLabelQtyByProduct((prev) => {
      const next = { ...prev };
      matched.forEach((row) => {
        next[row.id] = qty;
      });
      return next;
    });
  };

  const clearLabelSelection = () => {
    setLabelQtyByProduct({});
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("products")}</div>
          <div className="page-subtitle">{tt("productsPageSubtitle")}</div>
        </div>
      </div>

      <div className="pos-tabs">
        <div className="pos-tablist" role="tablist" aria-label={tt("productsTabsAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={productsTab === "form"}
            className={`pos-tab ${productsTab === "form" ? "pos-tab-active" : ""}`}
            onClick={() => setProductsTab("form")}
          >
            {tt("prodTabForm")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={productsTab === "list"}
            className={`pos-tab ${productsTab === "list" ? "pos-tab-active" : ""}`}
            onClick={() => setProductsTab("list")}
          >
            {tt("prodTabList")}
            <span className="pos-tab-badge">{products.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={productsTab === "labels"}
            className={`pos-tab ${productsTab === "labels" ? "pos-tab-active" : ""}`}
            onClick={() => setProductsTab("labels")}
          >
            {tt("prodTabLabels")}
            {selected ? <span className="pos-tab-badge pos-tab-badge-warn">{tt("prodBadgeSelected")}</span> : null}
          </button>
        </div>
      </div>

      {productsTab === "labels" ? (
      <div className="page-card" style={{ marginBottom: 12 }}>
        <h4 style={{ marginTop: 0 }}>{tt("prodLabelsTitle")}</h4>
        <p className="text-muted" style={{ marginTop: -2 }}>
          {tt("prodLabelsHelp")}
        </p>
        <div className="form-grid">
          <select className="form-select-sm" value={labelSize} onChange={(e) => setLabelSize(e.target.value)}>
            <option value="50x30">{tt("prodOpt5030")}</option>
            <option value="40x25">{tt("prodOpt4025")}</option>
            <option value="60x40">{tt("prodOpt6040")}</option>
          </select>
          <select className="form-select-sm" value={sheetTemplate} onChange={(e) => setSheetTemplate(e.target.value)}>
            <option value="free">{tt("prodOptLayoutFree")}</option>
            <option value="a4_3x8">{tt("prodOptA4_3x8")}</option>
            <option value="a4_4x10">{tt("prodOptA4_4x10")}</option>
          </select>
          <button type="button" onClick={printLabels}>
            {tt("prodPrintLabels", { n: selectedLabelProducts.length })}
          </button>
          <button type="button" className="btn-secondary" onClick={clearLabelSelection}>
            {tt("prodClearLabels")}
          </button>
          <input
            type="number"
            min={1}
            placeholder={tt("prodPhBulkQty")}
            value={bulkLabelQty}
            onChange={(e) => setBulkLabelQty(e.target.value)}
          />
          <Select
            className="form-select-sm"
            value={
              bulkCategory
                ? { value: bulkCategory, label: bulkCategory }
                : { value: "", label: tt("prodAllCategories") }
            }
            options={[
              { value: "", label: tt("prodAllCategories") },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
            onChange={(opt) => setBulkCategory(opt?.value || "")}
            placeholder={tt("prodAllCategories")}
            isClearable={false}
            isSearchable
            styles={SEARCH_SELECT_STYLES}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={bulkLowStockOnly}
              onChange={(e) => setBulkLowStockOnly(e.target.checked)}
            />
            {tt("prodLowStockOnly")}
          </label>
          <button type="button" className="btn-secondary" onClick={applyBulkSelection}>
            {tt("prodAutoSelectLabels")}
          </button>
        </div>
      </div>
      ) : null}

      {productsTab === "form" ? (
      <form onSubmit={handleSubmit} className="form-grid">
        <input
          placeholder={tt("prodPhName")}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />

        <input
          placeholder={tt("prodPhPrice")}
          type="number"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />

        <input
          placeholder={tt("prodPhStock")}
          type="number"
          value={form.stock}
          onChange={(e) => setForm({ ...form, stock: e.target.value })}
        />

        <input
          placeholder={tt("prodPhCategory")}
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        />
        <input
          placeholder={tt("prodPhSku")}
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
        />
        <input
          placeholder={tt("prodPhVat")}
          type="number"
          value={form.vatRate}
          onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
        />
        <input
          placeholder={tt("prodPhReorder")}
          type="number"
          min={0}
          value={form.reorderLevel}
          onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
        />
        <select
          className="form-select-sm"
          value={form.defaultDiscountType}
          onChange={(e) => setForm({ ...form, defaultDiscountType: e.target.value })}
        >
          <option value="">{tt("prodDiscNone")}</option>
          <option value="PERCENT">{tt("prodDiscPercent")}</option>
          <option value="AMOUNT">{tt("prodDiscAmount")}</option>
        </select>
        <input
          placeholder={tt("prodPhDiscVal")}
          type="number"
          value={form.defaultDiscountValue}
          onChange={(e) => setForm({ ...form, defaultDiscountValue: e.target.value })}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={form.batchTracked}
            onChange={(e) => setForm({ ...form, batchTracked: e.target.checked })}
            style={{ width: "auto" }}
          />
          {tt("prodBatchFefo")}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={form.sellByWeight}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                sellByWeight: e.target.checked,
                ...(e.target.checked ? { hasVariants: false } : {}),
              }))
            }
            style={{ width: "auto" }}
          />
          {tt("prodSellByKg")}
        </label>
        <input
          placeholder={tt("prodPhStockKg")}
          type="number"
          min={0}
          step={0.001}
          value={form.stockKg}
          disabled={!form.sellByWeight}
          onChange={(e) => setForm({ ...form, stockKg: e.target.value })}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={form.hasVariants}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                hasVariants: e.target.checked,
                ...(e.target.checked ? { sellByWeight: false, stockKg: "" } : {}),
              }))
            }
            style={{ width: "auto" }}
          />
          {tt("prodHasVariants")}
        </label>

        <button type="submit">{editingId ? tt("prodUpdateProduct") : tt("prodAddProduct")}</button>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={handleCancelEdit}>
            {tt("settingsCancel")}
          </button>
        ) : null}
      </form>
      ) : null}

      {productsTab === "list" ? (
      <DataTable
        title={tt("prodListTitle")}
        rows={products}
        searchableKeys={["name", "sku", "category"]}
        filters={[
          {
            key: "category",
            label: tt("prodFilterCategory"),
            options: [...new Set(products.map((p) => p.category).filter(Boolean))].map((c) => ({
              label: c,
              value: c,
            })),
          },
        ]}
        columns={[
          {
            key: "labelQty",
            label: tt("prodColLabelQty"),
            render: (_, row) => (
              <input
                type="number"
                min={0}
                value={labelQtyByProduct[row.id] ?? 0}
                onChange={(e) => setLabelQty(row.id, e.target.value)}
                style={{ width: 78 }}
              />
            ),
          },
          { key: "name", label: tt("prodLblName") },
          { key: "sku", label: tt("prodLblSku"), render: (v) => v || "-" },
          { key: "category", label: tt("prodLblCategory"), render: (v) => v || "-" },
          { key: "price", label: tt("prodLblPrice"), render: (v) => `৳${Number(v).toFixed(2)}` },
          {
            key: "stock",
            label: tt("prodLblStock"),
            render: (_, row) =>
              row.sellByWeight
                ? `${Number(row.stockKg || 0).toFixed(3)} ${tt("dashKgTag")}`
                : row.hasVariants
                  ? tt("prodVariantCount", { n: row.variants?.length || 0 })
                  : row.stock,
          },
          { key: "reorderLevel", label: tt("prodLblReorder"), render: (v) => Number(v || 0) },
          { key: "vatRate", label: tt("prodLblVat"), render: (v) => `${v}%` },
          { key: "batchTracked", label: tt("prodColBatch"), render: (v) => (v ? tt("prodYes") : "-") },
          {
            key: "defaultDiscountType",
            label: tt("prodColDefaultDiscount"),
            render: (v, row) =>
              v
                ? v === "PERCENT"
                  ? `${Number(row.defaultDiscountValue || 0)}%`
                  : `৳${Number(row.defaultDiscountValue || 0).toFixed(2)}`
                : "-",
          },
          {
            key: "actions",
            label: tt("colActions"),
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setLabelQty(row.id, Number(labelQtyByProduct[row.id] || 0) + 1)}>
                  {tt("prodPlusLabel")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleDetails(row)}>{tt("actionDetails")}</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => { handleEdit(row); setProductsTab("form"); }}>{tt("actionEdit")}</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(row)}>{tt("actionDelete")}</button>
              </div>
            ),
          },
        ]}
      />
      ) : null}

      {productsTab === "labels" && !selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <p className="text-muted" style={{ margin: 0 }}>
            {tt("prodLabelsPickProduct")}
          </p>
        </div>
      ) : null}

      {selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <h4>{tt("prodDetailTitle")}</h4>
          <p><strong>{tt("prodLblName")}:</strong> {selected.name}</p>
          <p><strong>{tt("prodLblSku")}:</strong> {selected.sku || "-"}</p>
          <p><strong>{tt("prodLblCategory")}:</strong> {selected.category || "-"}</p>
          <p><strong>{tt("prodLblPrice")}:</strong> ৳{Number(selected.price || 0).toFixed(2)}</p>
          <p><strong>{tt("prodLblStock")}:</strong> {selected.stock}</p>
          <p><strong>{tt("prodLblReorder")}:</strong> {Number(selected.reorderLevel || 0)}</p>
          <p><strong>{tt("prodLblVat")}:</strong> {Number(selected.vatRate || 0)}%</p>
          <p>
            <strong>{tt("prodLblDefaultDisc")}:</strong>{" "}
            {selected.defaultDiscountType
              ? `${selected.defaultDiscountType === "PERCENT" ? `${selected.defaultDiscountValue}%` : `৳${Number(selected.defaultDiscountValue || 0).toFixed(2)}`}`
              : "-"}
          </p>
          <p>
            <strong>{tt("prodLblBatch")}:</strong> {selected.batchTracked ? tt("prodYes") : tt("prodNo")}
          </p>
          <p>
            <strong>{tt("prodLblSellKg")}:</strong> {selected.sellByWeight ? tt("prodYes") : tt("prodNo")}
            {selected.sellByWeight
              ? ` — ${tt("prodStockKgOnHand", { n: Number(selected.stockKg || 0).toFixed(3) })}`
              : ""}
          </p>
          <p>
            <strong>{tt("prodLblVariants")}:</strong> {selected.hasVariants ? tt("prodYes") : tt("prodNo")}
          </p>
          {selected.hasVariants ? (
            <div style={{ marginTop: 12 }}>
              <h5 style={{ marginBottom: 8 }}>{tt("prodVariantBarcodes")}</h5>
              <ul style={{ margin: "0 0 8px 16px", padding: 0 }}>
                {(selected.variants || []).length === 0 ? (
                  <li style={{ color: "#64748b" }}>{tt("prodNoVariantsYet")}</li>
                ) : (
                  (selected.variants || []).map((v) => (
                    <li key={v.id} style={{ marginBottom: 4 }}>
                      <strong>{String(v.label || "").trim() || `#${v.id}`}</strong>
                      {` — ${tt("prodVariantStockSep", { n: v.stock })} — `}
                      {v.barcode || v.sku || tt("prodNoBarcode")}
                      {" — "}
                      {v.priceOverride != null && v.priceOverride !== ""
                        ? tt("prodPriceOverride", { n: Number(v.priceOverride).toFixed(2) })
                        : tt("prodPriceBase", { n: Number(selected.price || 0).toFixed(2) })}
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        style={{ marginLeft: 8 }}
                        onClick={async () => {
                          if (!window.confirm(tt("prodConfirmDeleteVariant", { name: String(v.label || "").trim() || `#${v.id}` }))) return;
                          await api.delete(`/products/${selected.id}/variants/${v.id}`);
                          await refreshSelectedProduct(selected.id);
                          fetchProducts();
                        }}
                      >
                        {tt("actionDelete")}
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <div className="form-grid">
                <input
                  placeholder={tt("prodPhVarLabel")}
                  value={variantDraft.label}
                  onChange={(e) => setVariantDraft({ ...variantDraft, label: e.target.value })}
                />
                <input
                  placeholder={tt("prodPhVarSku")}
                  value={variantDraft.sku}
                  onChange={(e) => setVariantDraft({ ...variantDraft, sku: e.target.value })}
                />
                <input
                  placeholder={tt("prodPhVarBarcode")}
                  value={variantDraft.barcode}
                  onChange={(e) => setVariantDraft({ ...variantDraft, barcode: e.target.value })}
                />
                <input
                  placeholder={tt("prodPhVarStock")}
                  type="number"
                  min={0}
                  value={variantDraft.stock}
                  onChange={(e) => setVariantDraft({ ...variantDraft, stock: e.target.value })}
                />
                <input
                  placeholder={tt("prodPhVarPrice")}
                  type="number"
                  value={variantDraft.priceOverride}
                  onChange={(e) => setVariantDraft({ ...variantDraft, priceOverride: e.target.value })}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    try {
                      await api.post(`/products/${selected.id}/variants`, {
                        label: variantDraft.label,
                        sku: variantDraft.sku || null,
                        barcode: variantDraft.barcode || null,
                        stock: Number(variantDraft.stock || 0),
                        priceOverride:
                          variantDraft.priceOverride !== ""
                            ? Number(variantDraft.priceOverride)
                            : null,
                      });
                      setVariantDraft({
                        label: "",
                        sku: "",
                        barcode: "",
                        stock: "0",
                        priceOverride: "",
                      });
                      await refreshSelectedProduct(selected.id);
                      fetchProducts();
                    } catch {
                      // Global submit-error toast handles POST failures.
                    }
                  }}
                >
                  {tt("prodAddVariant")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default Products;