import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SearchSelect from "../components/SearchSelect";
import useServerTable from "../hooks/useServerTable";
import JsBarcode from "jsbarcode";
import { notifyActionRequired, notifySuccess, notifyPermissionRequired } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import { getLang, t } from "../i18n";
import {
  APPAREL_SIZE_PRESETS,
  CATEGORY_ATTRIBUTE_PRESETS,
  GROCERY_CATEGORY_CHIPS,
  isApparelCategory,
  isPharmacyCategory,
} from "../constants/retailDepartments";
import ProductFormSections from "../components/ProductFormSections";
import {
  EMPTY_PRODUCT_FORM,
  productFormToPayload,
  rowToProductForm,
  STORAGE_OPTIONS,
} from "../utils/productMasterForm";
import { SALE_UNIT_LABEL_KEYS } from "../constants/saleUnits";
import { formatProductStockDisplay } from "../utils/formatSaleLineQty";
import {
  consumePendingLabelQueue,
  mergeIntoLabelQueue,
  writeLabelQueue,
} from "../utils/labelPrintQueue";

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
  const { hasPermission } = usePermissions();
  const canManageProducts = hasPermission("product.create");

  const requireProductCreate = () => {
    if (canManageProducts) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "product.create" }));
    return false;
  };

  const [products, setProducts] = useState([]);
  const [productCategories, setProductCategories] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_PRODUCT_FORM });
  const [formSection, setFormSection] = useState("identity");
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
  const [labelAisleFilter, setLabelAisleFilter] = useState("");
  const [sheetTemplate, setSheetTemplate] = useState("free");
  const [productsTab, setProductsTab] = useState("form");
  const [categoryForm, setCategoryForm] = useState({
    id: "",
    name: "",
    department: "",
    attributeSetText: "",
    minMarginPct: "",
  });
  const [seedingCategories, setSeedingCategories] = useState(false);

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
    if (selectedCategoryKey === "APPAREL" || selectedCategoryKey === "FOOTWEAR") return 15;
    if (selectedCategoryKey === "ELECTRONICS") return 20;
    if (isPharmacyCategory(selectedCategoryKey)) return 12;
    if (selectedCategoryKey === "GROCERY" || selectedCategoryKey === "DAIRY") return 8;
    return 10;
  }, [selectedCategoryKey, selectedCategoryConfig]);
  const categoryRetailHint = useMemo(() => {
    if (isPharmacyCategory(selectedCategoryKey)) {
      return form.batchTracked ? null : "pharmacy";
    }
    if (isApparelCategory(selectedCategoryKey)) {
      return form.hasVariants ? null : "apparel";
    }
    return null;
  }, [selectedCategoryKey, form.batchTracked, form.hasVariants]);
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

  // Server-driven data source for the product list table (backend search/sort/paging).
  const fetchProductPage = useCallback(async (q) => {
    const res = await api.get("/products", {
      params: {
        include: "variants",
        paged: true,
        page: q.page,
        pageSize: q.pageSize,
        sortKey: q.sortKey,
        sortDir: q.sortDir,
        search: JSON.stringify(q.search || {}),
        filters: JSON.stringify(q.filters || {}),
      },
    });
    return { data: res.data?.data || [], total: res.data?.total || 0 };
  }, []);
  const productsTable = useServerTable(fetchProductPage, {
    pageSize: 10,
    sortKey: "createdAt",
    sortDir: "desc",
  });

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

  useEffect(() => {
    if (!products.length) return;
    const pending = consumePendingLabelQueue();
    if (pending.tab === "labels") setProductsTab("labels");
    if (pending.aisle) {
      setLabelAisleFilter(pending.aisle);
      setBulkCategory(pending.aisle);
    }
    const queueIds = Object.keys(pending.queue || {});
    if (!queueIds.length) return;
    setLabelQtyByProduct((prev) => {
      const next = { ...prev };
      for (const [id, qty] of Object.entries(pending.queue)) {
        const n = Math.max(1, Math.floor(Number(qty || 1)));
        next[Number(id)] = Math.max(Number(next[Number(id)] || 0), n);
      }
      return next;
    });
  }, [products.length]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!requireProductCreate()) return;
    if (marginPreviewPct < minMarginPct) {
      notifyActionRequired(
        `Minimum margin for ${form.category || "this category"} is ${minMarginPct}%. Current margin ${marginPreviewPct.toFixed(2)}%.`
      );
      return;
    }
    const payload = productFormToPayload(form, attributeDraft);

    if (editingId) {
      await api.put(`/products/${editingId}`, payload);
    } else {
      await api.post("/products", payload);
    }

    setForm({ ...EMPTY_PRODUCT_FORM });
    setFormSection("identity");
    setEditingId(null);
    setSelected(null);
    setBarcodeAliasDraft({ barcode: "", note: "", variantId: "" });
    setAttributeDraft({});
    setPriceListDraft({ priceType: "RETAIL", amount: "", effectiveFrom: "", effectiveTo: "", note: "" });

    fetchProducts();
    productsTable.refresh();
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setSelected(row);
    setForm(rowToProductForm(row));
    setFormSection("identity");
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
    setForm({ ...EMPTY_PRODUCT_FORM });
    setFormSection("identity");
    setBarcodeAliasDraft({ barcode: "", note: "", variantId: "" });
    setAttributeDraft({});
    setPriceListDraft({ priceType: "RETAIL", amount: "", effectiveFrom: "", effectiveTo: "", note: "" });
  };

  const showPharmacySection = useMemo(
    () => isPharmacyCategory(selectedCategoryKey) || Boolean(form.genericName || form.drugRegNo),
    [selectedCategoryKey, form.genericName, form.drugRegNo]
  );

  const handleDelete = async (row) => {
    if (!requireProductCreate()) return;
    if (!window.confirm(tt("prodConfirmDeleteProduct", { name: row.name }))) return;
    await api.delete(`/products/${row.id}`);
    if (selected?.id === row.id) setSelected(null);
    if (editingId === row.id) handleCancelEdit();
    fetchProducts();
    productsTable.refresh();
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

        const unitLabelFor = (prod) => {
          const code = prod.saleUnit || prod.unitOfMeasure || "";
          const key = SALE_UNIT_LABEL_KEYS[code];
          return key ? tt(key) : code || "";
        };

        const makeSlices = (name, metaCode, unitPrice, codeForBarcode, extra = {}) => {
          const barcodeSvg = createBarcodeSvg(codeForBarcode);
          const mrpLine =
            Number(extra.mrp || 0) > 0
              ? `<div class="mrp">${tt("prodLabelMrp")}: ৳${Number(extra.mrp).toFixed(2)}</div>`
              : "";
          const unitLine = extra.unitLabel
            ? `<div class="unit">${escapeLabel(extra.unitLabel)}</div>`
            : "";
          return Array.from({ length: qty }).map(
            (_, idx) => `
          <div class="label">
            <div class="name">${escapeLabel(name)}</div>
            <div class="barcode">${barcodeSvg}</div>
            <div class="meta">${escapeLabel(metaCode)}</div>
            ${unitLine}
            ${mrpLine}
            <div class="price">৳${Number(unitPrice || 0).toFixed(2)}${extra.priceSuffix || ""}</div>
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
            return makeSlices(lbl, code, unit, code, {
              mrp: row.mrp,
              unitLabel: unitLabelFor(row),
            });
          });
        }

        const code =
          String(row.barcode || "").trim() || String(row.sku || "").trim() || `P-${row.id}`;
        const priceSuffix = row.sellByWeight ? "/kg" : "";
        return makeSlices(row.name, code, row.price || 0, code, {
          mrp: row.mrp,
          unitLabel: unitLabelFor(row),
          priceSuffix,
        });
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
            .unit, .mrp { font-size: 8px; color: #444; }
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

  const queueAisleLabels = (aisleId) => {
    const aisle = String(aisleId || "").trim().toUpperCase();
    if (!aisle) return;
    const qty = Math.max(1, Math.floor(Number(bulkLabelQty || 1)));
    const matched = products.filter((row) => String(row.category || "").trim().toUpperCase() === aisle);
    if (!matched.length) {
      notifyActionRequired(tt("prodNotifyBulkNoMatch"));
      return;
    }
    const queueEntries = matched.map((row) => ({ productId: row.id, qty }));
    const merged = mergeIntoLabelQueue(queueEntries);
    setLabelQtyByProduct((prev) => {
      const next = { ...prev };
      matched.forEach((row) => {
        next[row.id] = qty;
      });
      return next;
    });
    writeLabelQueue(merged);
    setLabelAisleFilter(aisle);
    setBulkCategory(aisle);
    setProductsTab("labels");
    notifySuccess(tt("prodLabelQueueAisleDone", { n: matched.length, aisle }));
  };

  const applyBulkSelection = () => {
    const qty = Math.max(1, Math.floor(Number(bulkLabelQty || 1)));
    const aisle = String(labelAisleFilter || bulkCategory || "").trim().toUpperCase();
    const matched = products.filter((row) => {
      const categoryOk = !aisle || String(row.category || "").trim().toUpperCase() === aisle;
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
    setCategoryForm({ id: "", name: "", department: "", attributeSetText: "", minMarginPct: "" });
  };

  const seedRetailCategories = async () => {
    setSeedingCategories(true);
    try {
      const res = await api.post("/master/product-categories/seed-retail");
      await fetchProducts();
      notifySuccess(
        tt("prodRetailSeedDone", {
          created: res.data?.created ?? 0,
          updated: res.data?.updated ?? 0,
        })
      );
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("prodRetailSeedFailed"));
    } finally {
      setSeedingCategories(false);
    }
  };

  const applyApparelSizePresets = async () => {
    setForm((f) => ({ ...f, hasVariants: true, sellByWeight: false, stockKg: "" }));
    if (!selected?.id) {
      notifyActionRequired(tt("prodApparelSizesAfterSave"));
      return;
    }
    const color = String(form.color || "Default").trim() || "Default";
    const baseSku = String(form.sku || form.name || "SKU")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 24);
    for (const size of APPAREL_SIZE_PRESETS) {
      await api.post(`/products/${selected.id}/variants`, {
        label: `${size} / ${color}`,
        sku: baseSku ? `${baseSku}-${size}` : null,
        barcode: null,
        stock: 0,
        priceOverride: null,
        imageUrl: null,
      });
    }
    await refreshSelectedProduct(selected.id);
    await fetchProducts();
    notifySuccess(tt("prodApparelSizesAdded"));
  };

  const saveCategory = async (e) => {
    e.preventDefault();
    if (!requireProductCreate()) return;
    const name = String(categoryForm.name || "").trim();
    if (!name) return;
    const attributeSet = String(categoryForm.attributeSetText || "")
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    const payload = {
      name,
      department: String(categoryForm.department || "").trim() || null,
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
      department: row.department || "",
      attributeSetText: Array.isArray(row.attributeSet) ? row.attributeSet.join(", ") : "",
      minMarginPct:
        row.minMarginPct != null && Number.isFinite(Number(row.minMarginPct))
          ? String(row.minMarginPct)
          : "",
    });
  };

  const deleteCategory = async (row) => {
    if (!requireProductCreate()) return;
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

  const storageLabel = (code) => {
    const opt = STORAGE_OPTIONS.find((o) => o.value === String(code || ""));
    return opt ? tt(opt.labelKey) : code || "-";
  };

  const conditionLabel = (code) => {
    const map = {
      NEW: tt("prodConditionNew"),
      REFURBISHED: tt("prodConditionRefurbished"),
      USED: tt("prodConditionUsed"),
    };
    return map[String(code || "").toUpperCase()] || "-";
  };

  const packingLabel = (row) => {
    const unit = String(row?.purchaseUnit || "").trim();
    const perPack = Number(row?.unitsPerPack || 0);
    const perCarton = Number(row?.packsPerCarton || 0);
    const parts = [];
    if (unit) parts.push(unit);
    if (perPack > 0) parts.push(tt("prodPackUnitsPerPack", { n: perPack }));
    if (perCarton > 0) parts.push(tt("prodPackPacksPerCarton", { n: perCarton }));
    return parts.length ? parts.join(" · ") : "-";
  };

  const dimensionsLabel = (row) => {
    const fmt = (v) => (v != null && v !== "" ? Number(v) : "—");
    return `${fmt(row?.lengthCm)} × ${fmt(row?.widthCm)} × ${fmt(row?.heightCm)} cm`;
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("products")}</div>
          <div className="page-subtitle">{tt("productsPageSubtitle")}</div>
        </div>
      </div>

      <PermissionBanner show={!canManageProducts} code="product.create" tt={tt} />

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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          <button
            type="button"
            className={`pos-dept-chip${!labelAisleFilter ? " active" : ""}`}
            onClick={() => {
              setLabelAisleFilter("");
              setBulkCategory("");
            }}
          >
            {tt("prodLabelAllAisles")}
          </button>
          {GROCERY_CATEGORY_CHIPS.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`pos-dept-chip${labelAisleFilter === cat.id ? " active" : ""}`}
              onClick={() => queueAisleLabels(cat.id)}
              title={tt("prodLabelQueueAisleHint")}
            >
              {tt(cat.labelKey)}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <SearchSelect
            className="form-select-sm"
            value={labelSize}
            onChange={(val) => setLabelSize(val || "50x30")}
            options={[
              { value: "50x30", label: tt("prodOpt5030") },
              { value: "40x25", label: tt("prodOpt4025") },
              { value: "60x40", label: tt("prodOpt6040") },
            ]}
            isClearable={false}
          />
          <SearchSelect
            className="form-select-sm"
            value={sheetTemplate}
            onChange={(val) => setSheetTemplate(val || "free")}
            options={[
              { value: "free", label: tt("prodOptLayoutFree") },
              { value: "a4_3x8", label: tt("prodOptA4_3x8") },
              { value: "a4_4x10", label: tt("prodOptA4_4x10") },
            ]}
            isClearable={false}
          />
          <button type="button" onClick={printLabels}>
            {tt("prodPrintLabels", { n: selectedLabelProducts.length })}
            {labelAisleFilter ? ` · ${labelAisleFilter}` : ""}
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
          <SearchSelect
            className="form-select-sm"
            value={bulkCategory}
            onChange={(val) => setBulkCategory(val)}
            placeholder={tt("prodAllCategories")}
            options={categories.map((c) => ({ value: c, label: c }))}
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={seedingCategories}
            onClick={seedRetailCategories}
          >
            {seedingCategories ? tt("settingsLoading") : tt("prodRetailSeedBtn")}
          </button>
        </div>
        <form onSubmit={saveCategory} className="form-grid" style={{ marginBottom: 12 }}>
          <input
            placeholder={tt("prodCategoryNamePlaceholder")}
            value={categoryForm.name}
            onChange={(e) => setCategoryForm((p) => ({ ...p, name: e.target.value }))}
            required
          />
          <SearchSelect
            className="form-select-sm"
            value={categoryForm.department}
            onChange={(val) => setCategoryForm((p) => ({ ...p, department: val }))}
            placeholder={tt("prodCategoryDeptAuto")}
            options={[
              { value: "GROCERY", label: tt("retailDeptGrocery") },
              { value: "PHARMACY", label: tt("retailDeptPharmacy") },
              { value: "APPAREL", label: tt("retailDeptApparel") },
              { value: "GENERAL", label: tt("prodCategoryDeptGeneral") },
            ]}
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
          <button type="submit" disabled={!canManageProducts}>{categoryForm.id ? tt("prodCategoryUpdateAction") : tt("prodCategoryAddAction")}</button>
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
              key: "department",
              label: tt("prodCategoryColumnDept"),
              render: (v) => {
                const d = String(v || "").toUpperCase();
                if (d === "GROCERY") return tt("retailDeptGrocery");
                if (d === "PHARMACY") return tt("retailDeptPharmacy");
                if (d === "APPAREL") return tt("retailDeptApparel");
                if (d === "GENERAL") return tt("prodCategoryDeptGeneral");
                return tt("na");
              },
            },
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
      <form onSubmit={handleSubmit} className="form-grid product-master-form">
        <ProductFormSections
          tt={tt}
          formSection={formSection}
          setFormSection={setFormSection}
          form={form}
          setForm={setForm}
          categories={categories}
          productCategories={productCategories}
          selectedCategoryKey={selectedCategoryKey}
          selectedAttributeKeys={selectedAttributeKeys}
          attributeDraft={attributeDraft}
          setAttributeDraft={setAttributeDraft}
          categoryRetailHint={categoryRetailHint}
          minMarginPct={minMarginPct}
          marginPreviewPct={marginPreviewPct}
          showPharmacySection={showPharmacySection}
          onEnableBatch={() =>
            setForm((f) => ({ ...f, batchTracked: true, hasVariants: false, sellByWeight: false }))
          }
          onAddSizeRun={() => void applyApparelSizePresets()}
        />
        <button type="submit" style={{ gridColumn: "1 / -1" }} disabled={!canManageProducts}>
          {editingId ? tt("prodUpdateProduct") : tt("prodAddProduct")}
        </button>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={handleCancelEdit} style={{ gridColumn: "1 / -1" }}>
            {tt("settingsCancel")}
          </button>
        ) : null}
      </form>
      </>
      ) : null}

      {productsTab === "list" ? (
      <DataTable
        title={tt("prodListTitle")}
        rows={productsTable.rows}
        serverMode
        totalRows={productsTable.total}
        loading={productsTable.loading}
        onQueryChange={productsTable.onQueryChange}
        initialSort="createdAt"
        initialSortDir="desc"
        pageSize={10}
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
            searchable: false,
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
          { key: "nameBn", label: tt("prodLblNameBn"), render: (v) => v || "-" },
          { key: "sku", label: tt("prodLblSku"), render: (v) => v || "-" },
          { key: "barcode", label: tt("prodLblBarcode"), render: (v) => v || "-" },
          { key: "category", label: tt("prodLblCategory"), render: (v) => v || "-" },
          { key: "manufacturer", label: tt("prodLblManufacturer"), render: (v) => v || "-" },
          { key: "genericName", label: tt("prodLblGenericName"), render: (v) => v || "-" },
          {
            key: "mrp",
            label: tt("prodLblMrp"),
            searchable: false,
            render: (v) => (v != null && Number(v) > 0 ? `৳${Number(v).toFixed(2)}` : "-"),
          },
          {
            key: "isActive",
            label: tt("prodLblActive"),
            searchable: false,
            render: (v) => (v === false ? tt("prodNo") : tt("prodYes")),
          },
          { key: "brand", label: tt("prodLblBrand"), render: (v) => v || "-" },
          { key: "model", label: tt("prodLblModel"), render: (v) => v || "-" },
          { key: "size", label: tt("prodLblSize"), render: (v) => v || "-" },
          { key: "color", label: tt("prodLblColor"), render: (v) => v || "-" },
          { key: "specification", label: tt("prodLblSpecification"), render: (v) => v || "-" },
          { key: "unitPrice", label: tt("prodLblUnitPrice"), searchable: false, render: (v) => `৳${Number(v || 0).toFixed(2)}` },
          { key: "price", label: tt("prodLblSellingPrice"), searchable: false, render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "profitMargin", label: tt("prodLblProfitMargin"), searchable: false, render: (_, row) => `${getProfitMarginPct(row).toFixed(2)}%` },
          {
            key: "stock",
            label: tt("prodLblStock"),
            searchable: false,
            render: (_, row) =>
              row.hasVariants
                ? tt("prodVariantCount", { n: row.variants?.length || 0 })
                : formatProductStockDisplay(row, tt),
          },
          { key: "reorderLevel", label: tt("prodLblReorder"), searchable: false, render: (v) => Number(v || 0) },
          { key: "vatRate", label: tt("prodLblVat"), searchable: false, render: (v) => `${v}%` },
          { key: "batchTracked", label: tt("prodColBatch"), searchable: false, render: (v) => (v ? tt("prodYes") : "-") },
          {
            key: "defaultDiscountType",
            label: tt("prodColDefaultDiscount"),
            searchable: false,
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
                <button type="button" className="btn-secondary btn-sm" onClick={() => { handleEdit(row); setProductsTab("form"); }} disabled={!canManageProducts}>{tt("actionEdit")}</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(row)} disabled={!canManageProducts}>{tt("actionDelete")}</button>
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
          <dl className="prod-detail-grid">
            <div><dt>{tt("prodLblName")}</dt><dd>{selected.name}</dd></div>
            <div><dt>{tt("prodLblNameBn")}</dt><dd>{selected.nameBn || "-"}</dd></div>
            <div><dt>{tt("prodLblActive")}</dt><dd>{selected.isActive === false ? tt("prodNo") : tt("prodYes")}</dd></div>
            <div><dt>{tt("prodLblSku")}</dt><dd>{selected.sku || "-"}</dd></div>
            <div><dt>{tt("prodLblBarcode")}</dt><dd>{selected.barcode || "-"}</dd></div>
            <div>
              <dt>{tt("prodLblBarcodeAliases")}</dt>
              <dd>
                {Array.isArray(selected.barcodes) && selected.barcodes.length
                  ? selected.barcodes.length
                  : tt("prodNoBarcodeAliases")}
              </dd>
            </div>
            <div><dt>{tt("prodLblCategory")}</dt><dd>{selected.category || "-"}</dd></div>
            <div><dt>{tt("prodLblUom")}</dt><dd>{tt(SALE_UNIT_LABEL_KEYS[selected.saleUnit || selected.unitOfMeasure] || selected.saleUnit || selected.unitOfMeasure || "PCS")}</dd></div>
            <div><dt>{tt("prodLblTags")}</dt><dd>{Array.isArray(selected.tags) && selected.tags.length ? selected.tags.join(", ") : "-"}</dd></div>
            <div><dt>{tt("prodLblBrand")}</dt><dd>{selected.brand || "-"}</dd></div>
            <div><dt>{tt("prodLblManufacturer")}</dt><dd>{selected.manufacturer || "-"}</dd></div>
            <div><dt>{tt("prodLblModel")}</dt><dd>{selected.model || "-"}</dd></div>
            <div><dt>{tt("prodPhCountry")}</dt><dd>{selected.countryOfOrigin || "-"}</dd></div>
            <div><dt>{tt("prodLblGenericName")}</dt><dd>{selected.genericName || "-"}</dd></div>
            <div><dt>{tt("prodPhStrength")}</dt><dd>{selected.strength || "-"}</dd></div>
            <div><dt>{tt("prodPhDosageForm")}</dt><dd>{selected.dosageForm || "-"}</dd></div>
            <div><dt>{tt("prodPhDrugRegNo")}</dt><dd>{selected.drugRegNo || "-"}</dd></div>
            <div><dt>{tt("prodLblSize")}</dt><dd>{selected.size || "-"}</dd></div>
            <div><dt>{tt("prodLblColor")}</dt><dd>{selected.color || "-"}</dd></div>
            <div className="prod-detail-span"><dt>{tt("prodLblSpecification")}</dt><dd>{selected.specification || "-"}</dd></div>
            <div><dt>{tt("prodLblUnitPrice")}</dt><dd>৳{Number(selected.unitPrice || 0).toFixed(2)}</dd></div>
            <div><dt>{tt("prodLblSellingPrice")}</dt><dd>৳{Number(selected.price || 0).toFixed(2)}</dd></div>
            <div><dt>{tt("prodLblMrp")}</dt><dd>{selected.mrp != null && Number(selected.mrp) > 0 ? `৳${Number(selected.mrp).toFixed(2)}` : "-"}</dd></div>
            <div><dt>{tt("prodPhHsCode")}</dt><dd>{selected.hsCode || "-"}</dd></div>
            <div><dt>{tt("prodLblProfitMargin")}</dt><dd>{getProfitMarginPct(selected).toFixed(2)}%</dd></div>
            <div><dt>{tt("prodLblStock")}</dt><dd>{selected.stock}</dd></div>
            <div><dt>{tt("prodLblReorder")}</dt><dd>{Number(selected.reorderLevel || 0)}</dd></div>
            <div><dt>{tt("prodLblVat")}</dt><dd>{Number(selected.vatRate || 0)}%</dd></div>
            <div><dt>{tt("prodLblStorage")}</dt><dd>{storageLabel(selected.storageCondition)}</dd></div>
            <div><dt>{tt("prodPhWeightGrams")}</dt><dd>{selected.weightGrams != null ? selected.weightGrams : "-"}</dd></div>
            <div><dt>{tt("prodPhShelfLife")}</dt><dd>{selected.shelfLifeDays != null ? selected.shelfLifeDays : "-"}</dd></div>
            <div>
              <dt>{tt("prodLblDefaultDisc")}</dt>
              <dd>
                {selected.defaultDiscountType
                  ? selected.defaultDiscountType === "PERCENT"
                    ? `${selected.defaultDiscountValue}%`
                    : `৳${Number(selected.defaultDiscountValue || 0).toFixed(2)}`
                  : "-"}
              </dd>
            </div>
            <div><dt>{tt("prodLblBatch")}</dt><dd>{selected.batchTracked ? tt("prodYes") : tt("prodNo")}</dd></div>
            <div>
              <dt>{tt("prodLblSellKg")}</dt>
              <dd>
                {selected.sellByWeight ? tt("prodYes") : tt("prodNo")}
                {selected.sellByWeight
                  ? ` — ${tt("prodStockKgOnHand", { n: Number(selected.stockKg || 0).toFixed(3) })}`
                  : ""}
              </dd>
            </div>
            <div><dt>{tt("prodLblVariants")}</dt><dd>{selected.hasVariants ? tt("prodYes") : tt("prodNo")}</dd></div>
            <div><dt>{tt("prodLblSd")}</dt><dd>{Number(selected.sdRate || 0)}%</dd></div>
            <div><dt>{tt("prodLblNbrCode")}</dt><dd>{selected.nbrProductCode || "-"}</dd></div>
            <div><dt>{tt("prodLblCondition")}</dt><dd>{conditionLabel(selected.productCondition)}</dd></div>
            <div><dt>{tt("prodLblBsti")}</dt><dd>{selected.bstiCertNo || "-"}</dd></div>
            <div>
              <dt>{tt("prodLblHalal")}</dt>
              <dd>
                {selected.isHalalCertified ? tt("prodYes") : tt("prodNo")}
                {selected.isHalalCertified && selected.halalCertNo ? ` — ${selected.halalCertNo}` : ""}
              </dd>
            </div>
            {selected.importerName ? (
              <div><dt>{tt("prodLblImporter")}</dt><dd>{selected.importerName}</dd></div>
            ) : null}
            {selected.importerAddress ? (
              <div className="prod-detail-span"><dt>{tt("prodLblImporterAddress")}</dt><dd>{selected.importerAddress}</dd></div>
            ) : null}
            {selected.purchaseUnit || selected.unitsPerPack || selected.packsPerCarton ? (
              <div><dt>{tt("prodLblPacking")}</dt><dd>{packingLabel(selected)}</dd></div>
            ) : null}
            {selected.netWeightGrams != null || selected.grossWeightGrams != null ? (
              <div>
                <dt>{tt("prodLblNetGross")}</dt>
                <dd>
                  {selected.netWeightGrams != null ? `${selected.netWeightGrams}g` : "-"}
                  {" / "}
                  {selected.grossWeightGrams != null ? `${selected.grossWeightGrams}g` : "-"}
                </dd>
              </div>
            ) : null}
            {selected.lengthCm != null || selected.widthCm != null || selected.heightCm != null ? (
              <div><dt>{tt("prodLblDimensions")}</dt><dd>{dimensionsLabel(selected)}</dd></div>
            ) : null}
            {selected.minOrderQty != null || selected.maxOrderQty != null ? (
              <div>
                <dt>{tt("prodLblOrderQty")}</dt>
                <dd>
                  {selected.minOrderQty != null ? selected.minOrderQty : "-"}
                  {" / "}
                  {selected.maxOrderQty != null ? selected.maxOrderQty : "-"}
                </dd>
              </div>
            ) : null}
            {selected.leadTimeDays != null ? (
              <div><dt>{tt("prodLblLeadTime")}</dt><dd>{tt("prodLeadTimeDays", { n: selected.leadTimeDays })}</dd></div>
            ) : null}
            {selected.shortDescription ? (
              <div className="prod-detail-span"><dt>{tt("prodLblShortDesc")}</dt><dd>{selected.shortDescription}</dd></div>
            ) : null}
            {selected.description ? (
              <div className="prod-detail-span"><dt>{tt("prodLblDescription")}</dt><dd>{selected.description}</dd></div>
            ) : null}
            {selected.internalNotes ? (
              <div className="prod-detail-span"><dt>{tt("prodLblInternalNotes")}</dt><dd>{selected.internalNotes}</dd></div>
            ) : null}
          </dl>
          {selected.imageUrl ? (
            <div style={{ marginTop: 12 }}>
              <img
                src={selected.imageUrl}
                alt={selected.name || "product"}
                style={{ maxWidth: 140, maxHeight: 140, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
            </div>
          ) : null}
          {Array.isArray(selected.imageGallery) && selected.imageGallery.length ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
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
            <div style={{ marginTop: 8 }}>
              <strong>{tt("prodSectionAttributes")}:</strong>{" "}
              {Object.entries(selected.attributeValues)
                .filter(([k, v]) => String(k || "").trim() && String(v || "").trim())
                .map(([k, v]) => `${k}: ${v}`)
                .join(" | ") || "-"}
            </div>
          ) : null}
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
              <SearchSelect
                className="form-select-sm"
                value={barcodeAliasDraft.variantId}
                onChange={(val) => setBarcodeAliasDraft((p) => ({ ...p, variantId: val }))}
                placeholder="Base product"
                options={(selected.variants || []).map((v) => ({
                  value: String(v.id),
                  label: v.sku || v.label || `Variant #${v.id}`,
                }))}
              />
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
              <SearchSelect
                className="form-select-sm"
                value={priceListDraft.priceType}
                onChange={(val) => setPriceListDraft((p) => ({ ...p, priceType: val || "RETAIL" }))}
                options={[
                  { value: "RETAIL", label: tt("prodPriceTypeRetail") },
                  { value: "WHOLESALE", label: tt("prodPriceTypeWholesale") },
                  { value: "DEALER", label: tt("prodPriceTypeDealer") },
                ]}
                isClearable={false}
              />
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