import { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import api from "../services/api";
import DataTable from "../components/DataTable";
import JsBarcode from "jsbarcode";
import { notifyActionRequired } from "../utils/notify";
import { createSearchSelectStyles } from "../utils/selectStyles";
import { getLang, t } from "../i18n";

const SEARCH_SELECT_STYLES = createSearchSelectStyles(38);
const CATEGORY_ATTRIBUTE_PRESETS = {
  APPAREL: ["size", "color", "material", "fit"],
  ELECTRONICS: ["brand", "model", "specification", "warranty"],
  FOOTWEAR: ["size", "color", "gender", "material"],
  GROCERY: ["brand", "pack_size", "origin"],
};

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
  const [productCategories, setProductCategories] = useState([]);
  const [form, setForm] = useState({
    name: "",
    unitPrice: "",
    price: "",
    stock: "",
    category: "",
    sku: "",
    barcode: "",
    imageUrl: "",
    size: "",
    color: "",
    brand: "",
    model: "",
    specification: "",
    imageGalleryText: "",
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
    imageUrl: "",
  });
  const [barcodeAliasDraft, setBarcodeAliasDraft] = useState({
    barcode: "",
    note: "",
    variantId: "",
  });
  const [attributeDraft, setAttributeDraft] = useState({});
  const [priceListDraft, setPriceListDraft] = useState({
    priceType: "RETAIL",
    amount: "",
    effectiveFrom: "",
    effectiveTo: "",
    note: "",
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
  const [categoryForm, setCategoryForm] = useState({
    id: "",
    name: "",
    attributeSetText: "",
    minMarginPct: "",
  });

  const selectedLabelProducts = useMemo(
    () => products.filter((p) => Number(labelQtyByProduct[p.id] || 0) > 0),
    [products, labelQtyByProduct]
  );

  const categories = useMemo(() => {
    const fromProducts = products.map((p) => String(p.category || "").trim()).filter(Boolean);
    const fromMaster = productCategories.map((c) => String(c.name || "").trim()).filter(Boolean);
    return [...new Set([...fromProducts, ...fromMaster])].sort((a, b) => a.localeCompare(b));
  }, [products, productCategories]);

  const selectedCategoryKey = useMemo(
    () => String(form.category || "").trim().toUpperCase(),
    [form.category]
  );
  const selectedCategoryConfig = useMemo(
    () =>
      (productCategories || []).find(
        (c) => String(c.name || "").trim().toUpperCase() === selectedCategoryKey
      ) || null,
    [productCategories, selectedCategoryKey]
  );
  const selectedAttributeKeys = useMemo(() => {
    const fromMaster = Array.isArray(selectedCategoryConfig?.attributeSet)
      ? selectedCategoryConfig.attributeSet.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    return fromMaster.length ? fromMaster : CATEGORY_ATTRIBUTE_PRESETS[selectedCategoryKey] || [];
  }, [selectedCategoryConfig, selectedCategoryKey]);
  const minMarginPct = useMemo(() => {
    if (
      selectedCategoryConfig &&
      selectedCategoryConfig.minMarginPct != null &&
      Number.isFinite(Number(selectedCategoryConfig.minMarginPct))
    ) {
      return Number(selectedCategoryConfig.minMarginPct);
    }
    if (selectedCategoryKey === "APPAREL") return 15;
    if (selectedCategoryKey === "ELECTRONICS") return 20;
    return 10;
  }, [selectedCategoryKey, selectedCategoryConfig]);
  const marginPreviewPct = useMemo(() => {
    const unit = Number(form.unitPrice || 0);
    const selling = Number(form.price || 0);
    if (!(selling > 0)) return 0;
    return ((selling - unit) / selling) * 100;
  }, [form.unitPrice, form.price]);

  const fetchProducts = async () => {
    const [res, categoriesRes] = await Promise.all([
      api.get("/products?include=variants,pricelists"),
      api.get("/master/product-categories"),
    ]);
    setProducts(Array.isArray(res.data) ? res.data : []);
    setProductCategories(Array.isArray(categoriesRes.data) ? categoriesRes.data : []);
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
    if (marginPreviewPct < minMarginPct) {
      notifyActionRequired(
        `Minimum margin for ${form.category || "this category"} is ${minMarginPct}%. Current margin ${marginPreviewPct.toFixed(2)}%.`
      );
      return;
    }
    const imageGallery = String(form.imageGalleryText || "")
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 20);

    const payload = {
      name: form.name,
      unitPrice: Number(form.unitPrice || 0),
      price: Number(form.price),
      stock: Number(form.stock),
      category: form.category,
      sku: form.sku || null,
      barcode: form.barcode || null,
      imageUrl: form.imageUrl || null,
      size: form.size || null,
      color: form.color || null,
      brand: form.brand || null,
      model: form.model || null,
      specification: form.specification || null,
      attributeValues: attributeDraft || {},
      imageGallery,
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
      unitPrice: "",
      price: "",
      stock: "",
      category: "",
      sku: "",
      barcode: "",
      imageUrl: "",
      size: "",
      color: "",
      brand: "",
      model: "",
      specification: "",
      imageGalleryText: "",
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
    setBarcodeAliasDraft({ barcode: "", note: "", variantId: "" });
    setAttributeDraft({});
    setPriceListDraft({ priceType: "RETAIL", amount: "", effectiveFrom: "", effectiveTo: "", note: "" });

    fetchProducts();
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setSelected(row);
    setForm({
      name: row.name || "",
      unitPrice: row.unitPrice ?? "",
      price: row.price ?? "",
      stock: row.stock ?? "",
      category: row.category || "",
      sku: row.sku || "",
      barcode: row.barcode || "",
      imageUrl: row.imageUrl || "",
      size: row.size || "",
      color: row.color || "",
      brand: row.brand || "",
      model: row.model || "",
      specification: row.specification || "",
      imageGalleryText: Array.isArray(row.imageGallery) ? row.imageGallery.join("\n") : "",
      vatRate: row.vatRate ?? "",
      reorderLevel: row.reorderLevel ?? "",
      defaultDiscountType: row.defaultDiscountType || "",
      defaultDiscountValue: row.defaultDiscountValue ?? "",
      batchTracked: Boolean(row.batchTracked),
      sellByWeight: Boolean(row.sellByWeight),
      stockKg: row.stockKg ?? "",
      hasVariants: Boolean(row.hasVariants),
    });
    setAttributeDraft(
      row && row.attributeValues && typeof row.attributeValues === "object" && !Array.isArray(row.attributeValues)
        ? row.attributeValues
        : {}
    );
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/products/${row.id}`);
    setSelected(res.data);
    setBarcodeAliasDraft({ barcode: "", note: "", variantId: "" });
    setAttributeDraft(
      res.data && res.data.attributeValues && typeof res.data.attributeValues === "object" && !Array.isArray(res.data.attributeValues)
        ? res.data.attributeValues
        : {}
    );
    setPriceListDraft({ priceType: "RETAIL", amount: "", effectiveFrom: "", effectiveTo: "", note: "" });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setForm({
      name: "",
      unitPrice: "",
      price: "",
      stock: "",
      category: "",
      sku: "",
      barcode: "",
      imageUrl: "",
      size: "",
      color: "",
      brand: "",
      model: "",
      specification: "",
      imageGalleryText: "",
      vatRate: "",
      reorderLevel: "",
      defaultDiscountType: "",
      defaultDiscountValue: "",
      batchTracked: false,
      sellByWeight: false,
      stockKg: "",
      hasVariants: false,
    });
    setBarcodeAliasDraft({ barcode: "", note: "", variantId: "" });
    setAttributeDraft({});
    setPriceListDraft({ priceType: "RETAIL", amount: "", effectiveFrom: "", effectiveTo: "", note: "" });
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

  const resetCategoryForm = () => {
    setCategoryForm({ id: "", name: "", attributeSetText: "", minMarginPct: "" });
  };

  const saveCategory = async (e) => {
    e.preventDefault();
    const name = String(categoryForm.name || "").trim();
    if (!name) return;
    const attributeSet = String(categoryForm.attributeSetText || "")
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    const payload = {
      name,
      attributeSet,
      minMarginPct:
        String(categoryForm.minMarginPct || "").trim() !== ""
          ? Number(categoryForm.minMarginPct)
          : null,
    };
    if (categoryForm.id) {
      await api.put(`/master/product-categories/${categoryForm.id}`, payload);
    } else {
      await api.post("/master/product-categories", payload);
    }
    resetCategoryForm();
    await fetchProducts();
  };

  const editCategory = (row) => {
    setCategoryForm({
      id: row.id,
      name: row.name || "",
      attributeSetText: Array.isArray(row.attributeSet) ? row.attributeSet.join(", ") : "",
      minMarginPct:
        row.minMarginPct != null && Number.isFinite(Number(row.minMarginPct))
          ? String(row.minMarginPct)
          : "",
    });
  };

  const deleteCategory = async (row) => {
    if (!window.confirm(tt("prodCategoryDeleteConfirm", { name: row.name }))) return;
    await api.delete(`/master/product-categories/${row.id}`);
    if (String(categoryForm.id || "") === String(row.id)) resetCategoryForm();
    await fetchProducts();
  };

  const getProfitMarginPct = (row) => {
    const unit = Number(row?.unitPrice || 0);
    const selling = Number(row?.price || 0);
    if (selling <= 0) return 0;
    return ((selling - unit) / selling) * 100;
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
      <>
      <div className="page-card" style={{ marginBottom: 12 }}>
        <h4 style={{ marginTop: 0 }}>{tt("prodCategoryAdminTitle")}</h4>
        <p className="text-muted" style={{ marginTop: -2 }}>
          {tt("prodCategoryAdminHelp")}
        </p>
        <form onSubmit={saveCategory} className="form-grid" style={{ marginBottom: 12 }}>
          <input
            placeholder={tt("prodCategoryNamePlaceholder")}
            value={categoryForm.name}
            onChange={(e) => setCategoryForm((p) => ({ ...p, name: e.target.value }))}
            required
          />
          <input
            placeholder={tt("prodCategoryMinMarginPlaceholder")}
            type="number"
            min={0}
            max={99.99}
            step={0.01}
            value={categoryForm.minMarginPct}
            onChange={(e) => setCategoryForm((p) => ({ ...p, minMarginPct: e.target.value }))}
          />
          <textarea
            placeholder={tt("prodCategoryAttributesPlaceholder")}
            rows={2}
            style={{ gridColumn: "1 / -1" }}
            value={categoryForm.attributeSetText}
            onChange={(e) => setCategoryForm((p) => ({ ...p, attributeSetText: e.target.value }))}
          />
          <button type="submit">{categoryForm.id ? tt("prodCategoryUpdateAction") : tt("prodCategoryAddAction")}</button>
          {categoryForm.id ? (
            <button type="button" className="btn-secondary" onClick={resetCategoryForm}>
              {tt("settingsCancel")}
            </button>
          ) : null}
        </form>
        <DataTable
          title={tt("prodCategoryListTitle", { n: productCategories.length })}
          rows={productCategories}
          searchableKeys={["name"]}
          columns={[
            { key: "name", label: tt("prodCategoryColumnCategory") },
            {
              key: "attributeSet",
              label: tt("prodCategoryColumnAttributes"),
              render: (v) => (Array.isArray(v) && v.length ? v.join(", ") : tt("na")),
            },
            {
              key: "minMarginPct",
              label: tt("prodCategoryColumnMinMargin"),
              render: (v) => (v != null && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : tt("na")),
            },
            {
              key: "actions",
              label: tt("colActions"),
              render: (_, row) => (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => editCategory(row)}>
                    {tt("actionEdit")}
                  </button>
                  <button type="button" className="btn-danger btn-sm" onClick={() => deleteCategory(row)}>
                    {tt("actionDelete")}
                  </button>
                </div>
              ),
            },
          ]}
        />
      </div>
      <form onSubmit={handleSubmit} className="form-grid">
        <input
          placeholder={tt("prodPhName")}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />

        <input
          placeholder={tt("prodPhUnitPrice")}
          type="number"
          value={form.unitPrice}
          onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
        />

        <input
          placeholder={tt("prodPhSellingPrice")}
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
          list="product-category-options"
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        />
        <datalist id="product-category-options">
          {categories.map((cat) => (
            <option key={cat} value={cat} />
          ))}
        </datalist>
        <input
          placeholder={tt("prodPhSku")}
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
        />
        <input
          placeholder={tt("prodPhBarcode")}
          value={form.barcode}
          onChange={(e) => setForm({ ...form, barcode: e.target.value })}
        />
        <input
          placeholder={tt("prodPhImageUrl")}
          value={form.imageUrl}
          onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
        />
        <input
          placeholder={tt("prodPhSize")}
          value={form.size}
          onChange={(e) => setForm({ ...form, size: e.target.value })}
        />
        <input
          placeholder={tt("prodPhColor")}
          value={form.color}
          onChange={(e) => setForm({ ...form, color: e.target.value })}
        />
        <input
          placeholder={tt("prodPhBrand")}
          value={form.brand}
          onChange={(e) => setForm({ ...form, brand: e.target.value })}
        />
        <input
          placeholder={tt("prodPhModel")}
          value={form.model}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        />
        <input
          placeholder={tt("prodPhSpecification")}
          value={form.specification}
          onChange={(e) => setForm({ ...form, specification: e.target.value })}
        />
        <textarea
          placeholder="Image gallery URLs (comma/newline separated)"
          value={form.imageGalleryText}
          onChange={(e) => setForm({ ...form, imageGalleryText: e.target.value })}
          rows={3}
          style={{ gridColumn: "1 / -1" }}
        />
        {selectedAttributeKeys.length ? (
          <div className="form-grid" style={{ gridColumn: "1 / -1" }}>
            {selectedAttributeKeys.map((key) => (
              <input
                key={`attr-${key}`}
                placeholder={`Attribute: ${key}`}
                value={attributeDraft[key] || ""}
                onChange={(e) =>
                  setAttributeDraft((prev) => ({
                    ...prev,
                    [key]: e.target.value,
                  }))
                }
              />
            ))}
          </div>
        ) : null}
        <input
          placeholder={tt("prodPhVat")}
          type="number"
          value={form.vatRate}
          onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
        />
        <div style={{ alignSelf: "center", fontSize: 12, color: marginPreviewPct < minMarginPct ? "#b91c1c" : "#166534" }}>
          Margin {marginPreviewPct.toFixed(2)}% (min {minMarginPct}%)
        </div>
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
      </>
      ) : null}

      {productsTab === "list" ? (
      <DataTable
        title={tt("prodListTitle")}
        rows={products}
        searchableKeys={["name", "sku", "barcode", "category", "size", "color", "brand", "model", "specification"]}
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
          { key: "barcode", label: tt("prodLblBarcode"), render: (v) => v || "-" },
          { key: "category", label: tt("prodLblCategory"), render: (v) => v || "-" },
          { key: "brand", label: tt("prodLblBrand"), render: (v) => v || "-" },
          { key: "model", label: tt("prodLblModel"), render: (v) => v || "-" },
          { key: "size", label: tt("prodLblSize"), render: (v) => v || "-" },
          { key: "color", label: tt("prodLblColor"), render: (v) => v || "-" },
          { key: "specification", label: tt("prodLblSpecification"), render: (v) => v || "-" },
          { key: "unitPrice", label: tt("prodLblUnitPrice"), render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "price", label: tt("prodLblSellingPrice"), render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "profitMargin", label: tt("prodLblProfitMargin"), render: (_, row) => `${getProfitMarginPct(row).toFixed(2)}%` },
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
          <p><strong>{tt("prodLblBarcode")}:</strong> {selected.barcode || "-"}</p>
          <p>
            <strong>{tt("prodLblBarcodeAliases")}:</strong>{" "}
            {Array.isArray(selected.barcodes) && selected.barcodes.length
              ? `${selected.barcodes.length}`
              : tt("prodNoBarcodeAliases")}
          </p>
          <p><strong>{tt("prodLblCategory")}:</strong> {selected.category || "-"}</p>
          <p><strong>{tt("prodLblImageUrl")}:</strong> {selected.imageUrl || "-"}</p>
          {selected.imageUrl ? (
            <p>
              <img
                src={selected.imageUrl}
                alt={selected.name || "product"}
                style={{ maxWidth: 140, maxHeight: 140, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </p>
          ) : null}
          {Array.isArray(selected.imageGallery) && selected.imageGallery.length ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {selected.imageGallery.map((url, idx) => (
                <img
                  key={`gallery-${idx}`}
                  src={url}
                  alt={`gallery-${idx}`}
                  style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid #e2e8f0" }}
                />
              ))}
            </div>
          ) : null}
          {selected.attributeValues && typeof selected.attributeValues === "object" ? (
            <div style={{ marginBottom: 8 }}>
              <strong>Attributes:</strong>{" "}
              {Object.entries(selected.attributeValues)
                .filter(([k, v]) => String(k || "").trim() && String(v || "").trim())
                .map(([k, v]) => `${k}: ${v}`)
                .join(" | ") || "-"}
            </div>
          ) : null}
          <p><strong>{tt("prodLblBrand")}:</strong> {selected.brand || "-"}</p>
          <p><strong>{tt("prodLblModel")}:</strong> {selected.model || "-"}</p>
          <p><strong>{tt("prodLblSize")}:</strong> {selected.size || "-"}</p>
          <p><strong>{tt("prodLblColor")}:</strong> {selected.color || "-"}</p>
          <p><strong>{tt("prodLblSpecification")}:</strong> {selected.specification || "-"}</p>
          <p><strong>{tt("prodLblUnitPrice")}:</strong> ৳{Number(selected.unitPrice || 0).toFixed(2)}</p>
          <p><strong>{tt("prodLblSellingPrice")}:</strong> ৳{Number(selected.price || 0).toFixed(2)}</p>
          <p><strong>{tt("prodLblProfitMargin")}:</strong> {getProfitMarginPct(selected).toFixed(2)}%</p>
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
                      {v.imageUrl ? " 🖼" : ""}
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
                <input
                  placeholder="Variant image URL"
                  value={variantDraft.imageUrl}
                  onChange={(e) => setVariantDraft({ ...variantDraft, imageUrl: e.target.value })}
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
                        imageUrl: variantDraft.imageUrl || null,
                      });
                      setVariantDraft({
                        label: "",
                        sku: "",
                        barcode: "",
                        stock: "0",
                        priceOverride: "",
                        imageUrl: "",
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
          <div style={{ marginTop: 12 }}>
            <h5 style={{ marginBottom: 8 }}>{tt("prodBarcodeAliasesTitle")}</h5>
            <ul style={{ margin: "0 0 8px 16px", padding: 0 }}>
              {(selected.barcodes || []).length === 0 ? (
                <li style={{ color: "#64748b" }}>{tt("prodNoBarcodeAliases")}</li>
              ) : (
                (selected.barcodes || []).map((b) => (
                  <li key={b.id} style={{ marginBottom: 4 }}>
                    <strong>{b.barcode}</strong>
                    {b.productVariant
                      ? ` — SKU: ${b.productVariant.sku || b.productVariant.label || `#${b.productVariant.id}`}`
                      : ""}
                    {b.note ? ` — ${b.note}` : ""}
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      style={{ marginLeft: 8 }}
                      onClick={async () => {
                        if (!window.confirm(tt("prodConfirmDeleteBarcodeAlias", { code: b.barcode }))) return;
                        await api.delete(`/products/${selected.id}/barcodes/${b.id}`);
                        await refreshSelectedProduct(selected.id);
                      }}
                    >
                      {tt("actionDelete")}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="form-grid">
              <select
                className="form-select-sm"
                value={barcodeAliasDraft.variantId}
                onChange={(e) => setBarcodeAliasDraft((p) => ({ ...p, variantId: e.target.value }))}
              >
                <option value="">Base product</option>
                {(selected.variants || []).map((v) => (
                  <option key={`barcode-variant-${v.id}`} value={v.id}>
                    {v.sku || v.label || `Variant #${v.id}`}
                  </option>
                ))}
              </select>
              <input
                placeholder={tt("prodPhBarcodeAlias")}
                value={barcodeAliasDraft.barcode}
                onChange={(e) => setBarcodeAliasDraft((p) => ({ ...p, barcode: e.target.value }))}
              />
              <input
                placeholder={tt("prodPhBarcodeAliasNote")}
                value={barcodeAliasDraft.note}
                onChange={(e) => setBarcodeAliasDraft((p) => ({ ...p, note: e.target.value }))}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  if (!String(barcodeAliasDraft.barcode || "").trim()) return;
                  try {
                    await api.post(`/products/${selected.id}/barcodes`, {
                      barcode: barcodeAliasDraft.barcode,
                      note: barcodeAliasDraft.note || null,
                      variantId: barcodeAliasDraft.variantId
                        ? Number(barcodeAliasDraft.variantId)
                        : null,
                    });
                    setBarcodeAliasDraft({ barcode: "", note: "", variantId: "" });
                    await refreshSelectedProduct(selected.id);
                  } catch {
                    // Global submit-error toast handles POST failures.
                  }
                }}
              >
                {tt("prodAddBarcodeAlias")}
              </button>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <h5 style={{ marginBottom: 8 }}>{tt("prodPriceListTitle")}</h5>
            <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>
              {tt("prodPriceListNoOverlapHint")}
            </p>
            <div className="page-card" style={{ marginBottom: 8, background: "#f8fafc" }}>
              <strong style={{ display: "block", marginBottom: 8 }}>{tt("prodPriceTimelineTitle")}</strong>
              {["RETAIL", "WHOLESALE", "DEALER"].map((tier) => {
                const rows = (selected.priceLists || [])
                  .filter((r) => String(r.priceType || "").toUpperCase() === tier)
                  .sort((a, b) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime());
                return (
                  <div key={tier} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      {tier === "RETAIL" ? tt("prodPriceTypeRetail") : tier === "WHOLESALE" ? tt("prodPriceTypeWholesale") : tt("prodPriceTypeDealer")}
                    </div>
                    {!rows.length ? (
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        {tt("prodNoPriceListRows")}
                      </span>
                    ) : (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {rows.map((r) => (
                          <span
                            key={r.id}
                            style={{
                              border: "1px solid #cbd5e1",
                              borderRadius: 999,
                              padding: "2px 8px",
                              fontSize: 12,
                              background: "#fff",
                            }}
                            title={r.note || ""}
                          >
                            {`${String(r.effectiveFrom).slice(0, 10)} → ${r.effectiveTo ? String(r.effectiveTo).slice(0, 10) : tt("prodOpenEnded")}`} · ৳{Number(r.amount || 0).toFixed(2)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <ul style={{ margin: "0 0 8px 16px", padding: 0 }}>
              {(selected.priceLists || []).length === 0 ? (
                <li style={{ color: "#64748b" }}>{tt("prodNoPriceListRows")}</li>
              ) : (
                (selected.priceLists || []).map((pl) => (
                  <li key={pl.id} style={{ marginBottom: 4 }}>
                    <strong>{pl.priceType}</strong>
                    {` — ৳${Number(pl.amount || 0).toFixed(2)} — ${String(pl.effectiveFrom || "").slice(0, 10)} to ${pl.effectiveTo ? String(pl.effectiveTo).slice(0, 10) : "open"}`}
                    {pl.note ? ` — ${pl.note}` : ""}
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      style={{ marginLeft: 8 }}
                      onClick={async () => {
                        if (!window.confirm(tt("prodConfirmDeletePriceListRow"))) return;
                        await api.delete(`/products/${selected.id}/price-lists/${pl.id}`);
                        await refreshSelectedProduct(selected.id);
                      }}
                    >
                      {tt("actionDelete")}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="form-grid">
              <select
                className="form-select-sm"
                value={priceListDraft.priceType}
                onChange={(e) => setPriceListDraft((p) => ({ ...p, priceType: e.target.value }))}
              >
                <option value="RETAIL">{tt("prodPriceTypeRetail")}</option>
                <option value="WHOLESALE">{tt("prodPriceTypeWholesale")}</option>
                <option value="DEALER">{tt("prodPriceTypeDealer")}</option>
              </select>
              <input
                placeholder={tt("prodPhPriceListAmount")}
                type="number"
                min={0}
                value={priceListDraft.amount}
                onChange={(e) => setPriceListDraft((p) => ({ ...p, amount: e.target.value }))}
              />
              <input
                type="date"
                value={priceListDraft.effectiveFrom}
                onChange={(e) => setPriceListDraft((p) => ({ ...p, effectiveFrom: e.target.value }))}
              />
              <input
                type="date"
                value={priceListDraft.effectiveTo}
                onChange={(e) => setPriceListDraft((p) => ({ ...p, effectiveTo: e.target.value }))}
              />
              <input
                placeholder={tt("prodPhPriceListNote")}
                value={priceListDraft.note}
                onChange={(e) => setPriceListDraft((p) => ({ ...p, note: e.target.value }))}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  if (!priceListDraft.effectiveFrom) return;
                  const nextFrom = new Date(`${priceListDraft.effectiveFrom}T00:00:00.000Z`);
                  const nextTo = priceListDraft.effectiveTo ? new Date(`${priceListDraft.effectiveTo}T23:59:59.999Z`) : null;
                  const overlaps = (selected.priceLists || []).some((row) => {
                    if (String(row.priceType || "").toUpperCase() !== String(priceListDraft.priceType || "").toUpperCase()) return false;
                    const exFrom = row.effectiveFrom ? new Date(row.effectiveFrom) : null;
                    const exTo = row.effectiveTo ? new Date(row.effectiveTo) : null;
                    if (!exFrom) return false;
                    const aStart = nextFrom.getTime();
                    const aEnd = nextTo ? nextTo.getTime() : Number.POSITIVE_INFINITY;
                    const bStart = exFrom.getTime();
                    const bEnd = exTo ? exTo.getTime() : Number.POSITIVE_INFINITY;
                    return aStart <= bEnd && bStart <= aEnd;
                  });
                  if (overlaps) {
                    notifyActionRequired(tt("prodPriceListOverlapWarn"));
                    return;
                  }
                  await api.post(`/products/${selected.id}/price-lists`, {
                    priceType: priceListDraft.priceType,
                    amount: Number(priceListDraft.amount || 0),
                    effectiveFrom: priceListDraft.effectiveFrom,
                    effectiveTo: priceListDraft.effectiveTo || null,
                    note: priceListDraft.note || null,
                  });
                  setPriceListDraft({ priceType: "RETAIL", amount: "", effectiveFrom: "", effectiveTo: "", note: "" });
                  await refreshSelectedProduct(selected.id);
                }}
              >
                {tt("prodAddPriceListRow")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Products;