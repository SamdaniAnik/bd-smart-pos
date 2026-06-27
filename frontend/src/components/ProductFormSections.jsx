import { useMemo } from "react";
import {
  CONDITION_OPTIONS,
  PRODUCT_FORM_SECTIONS,
  STORAGE_OPTIONS,
} from "../utils/productMasterForm";
import { isPharmacyCategory, resolveCategoryDepartment } from "../constants/retailDepartments";
import {
  getAllowedSaleUnitsForDepartment,
  getDefaultSaleUnitForDepartment,
  isWeightSaleUnit,
  SALE_UNIT_LABEL_KEYS,
} from "../constants/saleUnits";
import SearchSelect from "./SearchSelect";

export default function ProductFormSections({
  tt,
  formSection,
  setFormSection,
  form,
  setForm,
  categories,
  productCategories,
  selectedCategoryKey,
  selectedAttributeKeys,
  attributeDraft,
  setAttributeDraft,
  categoryRetailHint,
  minMarginPct,
  marginPreviewPct,
  onEnableBatch,
  onAddSizeRun,
  showPharmacySection,
}) {
  const categoryOptions = productCategories.length
    ? productCategories.map((c) => c.name)
    : categories;

  const selectedCategoryConfig = useMemo(
    () =>
      productCategories.find(
        (c) => String(c.name || "").trim().toUpperCase() === String(selectedCategoryKey || "").trim()
      ) || null,
    [productCategories, selectedCategoryKey]
  );

  const retailDept = resolveCategoryDepartment(form.category, selectedCategoryConfig);
  const saleUnitOptions = getAllowedSaleUnitsForDepartment(retailDept);

  const applySaleUnit = (unitCode) => {
    const sellByWt = isWeightSaleUnit(unitCode);
    setForm((f) => ({
      ...f,
      saleUnit: unitCode,
      unitOfMeasure: unitCode,
      sellByWeight: sellByWt,
      ...(sellByWt ? { hasVariants: false } : {}),
    }));
  };

  return (
    <>
      <div className="pos-department-chips" style={{ gridColumn: "1 / -1", marginBottom: 4 }}>
        {PRODUCT_FORM_SECTIONS.map((sec) => {
          if (sec.id === "pharmacy" && !showPharmacySection) return null;
          return (
            <button
              key={sec.id}
              type="button"
              className={`pos-dept-chip ${formSection === sec.id ? "pos-dept-chip-active" : ""}`}
              onClick={() => setFormSection(sec.id)}
            >
              {tt(sec.labelKey)}
            </button>
          );
        })}
      </div>

      {formSection === "identity" ? (
        <>
          <input
            placeholder={tt("prodPhName")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            placeholder={tt("prodPhNameBn")}
            value={form.nameBn}
            onChange={(e) => setForm({ ...form, nameBn: e.target.value })}
          />
          <SearchSelect
            className="form-select-sm"
            value={form.categoryId || form.category}
            onChange={(val) => {
              const cat = productCategories.find((c) => String(c.id) === val || c.name === val);
              const catName = cat ? cat.name : val;
              const dept = resolveCategoryDepartment(catName, cat);
              const defaultUnit = getDefaultSaleUnitForDepartment(dept);
              const sellByWt = isWeightSaleUnit(defaultUnit);
              setForm({
                ...form,
                categoryId: cat ? String(cat.id) : "",
                category: catName,
                saleUnit: defaultUnit,
                unitOfMeasure: defaultUnit,
                sellByWeight: sellByWt,
                ...(sellByWt ? { hasVariants: false } : {}),
              });
            }}
            placeholder={tt("prodPhCategory")}
            options={[
              ...productCategories.map((c) => ({ value: String(c.id), label: c.name })),
              ...categories
                .filter((name) => !productCategories.some((c) => c.name === name))
                .map((name) => ({ value: name, label: name })),
            ]}
          />
          <input placeholder={tt("prodPhSku")} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <input
            placeholder={tt("prodPhBarcode")}
            value={form.barcode}
            onChange={(e) => setForm({ ...form, barcode: e.target.value })}
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
            placeholder={tt("prodPhManufacturer")}
            value={form.manufacturer}
            onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
          />
          <input
            placeholder={tt("prodPhCountry")}
            value={form.countryOfOrigin}
            onChange={(e) => setForm({ ...form, countryOfOrigin: e.target.value })}
          />
          <SearchSelect
            className="form-select-sm"
            value={form.saleUnit || form.unitOfMeasure || getDefaultSaleUnitForDepartment(retailDept)}
            onChange={(val) => applySaleUnit(val)}
            options={saleUnitOptions.map((u) => ({
              value: u,
              label: tt(SALE_UNIT_LABEL_KEYS[u] || u),
            }))}
            isClearable={false}
          />
          <p className="text-muted" style={{ gridColumn: "1 / -1", margin: 0, fontSize: 12 }}>
            {tt("prodSaleUnitHelp")}
          </p>
          <input
            placeholder={tt("prodPhTags")}
            value={form.tagsText}
            onChange={(e) => setForm({ ...form, tagsText: e.target.value })}
            style={{ gridColumn: "1 / -1" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              style={{ width: "auto" }}
            />
            {tt("prodActiveSellable")}
          </label>
        </>
      ) : null}

      {formSection === "pricing" ? (
        <>
          <input
            placeholder={tt("prodPhUnitPrice")}
            type="number"
            min={0}
            step={0.01}
            value={form.unitPrice}
            onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
          />
          <input
            placeholder={tt("prodPhSellingPrice")}
            type="number"
            min={0}
            step={0.01}
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            required
          />
          <input
            placeholder={tt("prodPhMrp")}
            type="number"
            min={0}
            step={0.01}
            value={form.mrp}
            onChange={(e) => setForm({ ...form, mrp: e.target.value })}
          />
          <input
            placeholder={tt("prodPhHsCode")}
            value={form.hsCode}
            onChange={(e) => setForm({ ...form, hsCode: e.target.value })}
          />
          <input
            placeholder={tt("prodPhNbrCode")}
            value={form.nbrProductCode}
            onChange={(e) => setForm({ ...form, nbrProductCode: e.target.value })}
          />
          <input
            placeholder={tt("prodPhVat")}
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={form.vatRate}
            onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
          />
          <input
            placeholder={tt("prodPhSd")}
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={form.sdRate}
            onChange={(e) => setForm({ ...form, sdRate: e.target.value })}
          />
          <div
            style={{
              alignSelf: "center",
              fontSize: 12,
              color: marginPreviewPct < minMarginPct ? "#b91c1c" : "#166534",
            }}
          >
            {tt("prodMarginPreview", {
              current: marginPreviewPct.toFixed(2),
              min: minMarginPct,
            })}
          </div>
          <SearchSelect
            className="form-select-sm"
            value={form.defaultDiscountType}
            onChange={(val) => setForm({ ...form, defaultDiscountType: val })}
            placeholder={tt("prodDiscNone")}
            options={[
              { value: "PERCENT", label: tt("prodDiscPercent") },
              { value: "AMOUNT", label: tt("prodDiscAmount") },
            ]}
          />
          <input
            placeholder={tt("prodPhDiscVal")}
            type="number"
            value={form.defaultDiscountValue}
            onChange={(e) => setForm({ ...form, defaultDiscountValue: e.target.value })}
          />
        </>
      ) : null}

      {formSection === "inventory" ? (
        <>
          <input
            placeholder={tt("prodPhStock")}
            type="number"
            min={0}
            value={form.stock}
            disabled={form.hasVariants}
            onChange={(e) => setForm({ ...form, stock: e.target.value })}
          />
          <input
            placeholder={tt("prodPhReorder")}
            type="number"
            min={0}
            value={form.reorderLevel}
            onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
          />
          <input
            placeholder={tt("prodPhWeightGrams")}
            type="number"
            min={0}
            step={0.01}
            value={form.weightGrams}
            onChange={(e) => setForm({ ...form, weightGrams: e.target.value })}
          />
          <input
            placeholder={tt("prodPhShelfLife")}
            type="number"
            min={0}
            value={form.shelfLifeDays}
            onChange={(e) => setForm({ ...form, shelfLifeDays: e.target.value })}
          />
          <SearchSelect
            className="form-select-sm"
            value={form.storageCondition}
            onChange={(val) => setForm({ ...form, storageCondition: val })}
            options={STORAGE_OPTIONS.map((opt) => ({
              value: opt.value,
              label: tt(opt.labelKey),
            }))}
            isClearable={false}
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
              checked={form.trackExpiry}
              onChange={(e) => setForm({ ...form, trackExpiry: e.target.checked })}
              style={{ width: "auto" }}
              disabled={form.batchTracked}
            />
            {tt("prodTrackExpiry")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.trackSerial}
              onChange={(e) => setForm({ ...form, trackSerial: e.target.checked, ...(e.target.checked ? { sellByWeight: false, hasVariants: false } : {}) })}
              style={{ width: "auto" }}
            />
            {tt("prodTrackSerial")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.trackImei}
              onChange={(e) => setForm({ ...form, trackImei: e.target.checked, ...(e.target.checked ? { sellByWeight: false, hasVariants: false } : {}) })}
              style={{ width: "auto" }}
            />
            {tt("prodTrackImei")}
          </label>
          {form.trackSerial || form.trackImei ? (
            <input
              type="number"
              min={0}
              placeholder={tt("prodWarrantyDaysPh")}
              value={form.warrantyDays}
              onChange={(e) => setForm({ ...form, warrantyDays: e.target.value })}
            />
          ) : null}
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.requiresKyc}
              onChange={(e) => setForm({ ...form, requiresKyc: e.target.checked })}
              style={{ width: "auto" }}
            />
            {tt("prodRequiresKyc")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.isRawMaterial}
              onChange={(e) =>
                setForm({
                  ...form,
                  isRawMaterial: e.target.checked,
                  ...(e.target.checked && !form.isManufactured
                    ? { sellByWeight: false, hasVariants: false, trackSerial: false }
                    : {}),
                })
              }
              style={{ width: "auto" }}
            />
            {tt("prodRawMaterial")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.isManufactured}
              onChange={(e) =>
                setForm({
                  ...form,
                  isManufactured: e.target.checked,
                })
              }
              style={{ width: "auto" }}
            />
            {tt("prodManufacturedItem")}
          </label>
          {form.isRawMaterial && form.isManufactured ? (
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              {tt("prodSemiFinishedHelp")}
            </p>
          ) : null}
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
          {categoryRetailHint === "pharmacy" ? (
            <div className="retail-hint-banner retail-hint-pharmacy" style={{ gridColumn: "1 / -1" }}>
              <span>{tt("prodHintPharmacyBatch")}</span>
              <button type="button" className="btn-secondary btn-sm" onClick={onEnableBatch}>
                {tt("prodHintEnableBatch")}
              </button>
            </div>
          ) : null}
          {categoryRetailHint === "apparel" ? (
            <div className="retail-hint-banner retail-hint-apparel" style={{ gridColumn: "1 / -1" }}>
              <span>{tt("prodHintApparelVariants")}</span>
              <button type="button" className="btn-secondary btn-sm" onClick={onAddSizeRun}>
                {tt("prodHintAddSizeRun")}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {formSection === "compliance" ? (
        <>
          <h5 className="prod-form-subhead" style={{ gridColumn: "1 / -1", margin: "4px 0 0" }}>
            {tt("prodSubheadCertification")}
          </h5>
          <input
            placeholder={tt("prodPhBstiCert")}
            value={form.bstiCertNo}
            onChange={(e) => setForm({ ...form, bstiCertNo: e.target.value })}
          />
          <SearchSelect
            className="form-select-sm"
            value={form.productCondition}
            onChange={(val) => setForm({ ...form, productCondition: val })}
            options={CONDITION_OPTIONS.map((opt) => ({ value: opt.value, label: tt(opt.labelKey) }))}
            isClearable={false}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.isHalalCertified}
              onChange={(e) => setForm({ ...form, isHalalCertified: e.target.checked })}
              style={{ width: "auto" }}
            />
            {tt("prodHalalCertified")}
          </label>
          <input
            placeholder={tt("prodPhHalalCert")}
            value={form.halalCertNo}
            disabled={!form.isHalalCertified}
            onChange={(e) => setForm({ ...form, halalCertNo: e.target.value })}
          />

          <h5 className="prod-form-subhead" style={{ gridColumn: "1 / -1", margin: "8px 0 0" }}>
            {tt("prodSubheadImporter")}
          </h5>
          <input
            placeholder={tt("prodPhImporterName")}
            value={form.importerName}
            onChange={(e) => setForm({ ...form, importerName: e.target.value })}
          />
          <input
            placeholder={tt("prodPhImporterAddress")}
            value={form.importerAddress}
            onChange={(e) => setForm({ ...form, importerAddress: e.target.value })}
            style={{ gridColumn: "1 / -1" }}
          />

          <h5 className="prod-form-subhead" style={{ gridColumn: "1 / -1", margin: "8px 0 0" }}>
            {tt("prodSubheadPacking")}
          </h5>
          <input
            placeholder={tt("prodPhPurchaseUnit")}
            value={form.purchaseUnit}
            onChange={(e) => setForm({ ...form, purchaseUnit: e.target.value })}
          />
          <input
            placeholder={tt("prodPhUnitsPerPack")}
            type="number"
            min={0}
            value={form.unitsPerPack}
            onChange={(e) => setForm({ ...form, unitsPerPack: e.target.value })}
          />
          <input
            placeholder={tt("prodPhPacksPerCarton")}
            type="number"
            min={0}
            value={form.packsPerCarton}
            onChange={(e) => setForm({ ...form, packsPerCarton: e.target.value })}
          />
          <p className="text-muted" style={{ gridColumn: "1 / -1", margin: 0, fontSize: 12 }}>
            {tt("prodPackingHelp")}
          </p>

          <h5 className="prod-form-subhead" style={{ gridColumn: "1 / -1", margin: "8px 0 0" }}>
            {tt("prodSubheadLogistics")}
          </h5>
          <input
            placeholder={tt("prodPhNetWeight")}
            type="number"
            min={0}
            step={0.01}
            value={form.netWeightGrams}
            onChange={(e) => setForm({ ...form, netWeightGrams: e.target.value })}
          />
          <input
            placeholder={tt("prodPhGrossWeight")}
            type="number"
            min={0}
            step={0.01}
            value={form.grossWeightGrams}
            onChange={(e) => setForm({ ...form, grossWeightGrams: e.target.value })}
          />
          <input
            placeholder={tt("prodPhLengthCm")}
            type="number"
            min={0}
            step={0.1}
            value={form.lengthCm}
            onChange={(e) => setForm({ ...form, lengthCm: e.target.value })}
          />
          <input
            placeholder={tt("prodPhWidthCm")}
            type="number"
            min={0}
            step={0.1}
            value={form.widthCm}
            onChange={(e) => setForm({ ...form, widthCm: e.target.value })}
          />
          <input
            placeholder={tt("prodPhHeightCm")}
            type="number"
            min={0}
            step={0.1}
            value={form.heightCm}
            onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
          />
          <input
            placeholder={tt("prodPhMinOrderQty")}
            type="number"
            min={0}
            value={form.minOrderQty}
            onChange={(e) => setForm({ ...form, minOrderQty: e.target.value })}
          />
          <input
            placeholder={tt("prodPhMaxOrderQty")}
            type="number"
            min={0}
            value={form.maxOrderQty}
            onChange={(e) => setForm({ ...form, maxOrderQty: e.target.value })}
          />
          <input
            placeholder={tt("prodPhLeadTimeDays")}
            type="number"
            min={0}
            value={form.leadTimeDays}
            onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })}
          />
        </>
      ) : null}

      {formSection === "pharmacy" && showPharmacySection ? (
        <>
          <input
            placeholder={tt("prodPhGenericName")}
            value={form.genericName}
            onChange={(e) => setForm({ ...form, genericName: e.target.value })}
          />
          <input
            placeholder={tt("prodPhStrength")}
            value={form.strength}
            onChange={(e) => setForm({ ...form, strength: e.target.value })}
          />
          <input
            placeholder={tt("prodPhDosageForm")}
            value={form.dosageForm}
            onChange={(e) => setForm({ ...form, dosageForm: e.target.value })}
          />
          <input
            placeholder={tt("prodPhDrugRegNo")}
            value={form.drugRegNo}
            onChange={(e) => setForm({ ...form, drugRegNo: e.target.value })}
          />
        </>
      ) : null}

      {formSection === "attributes" ? (
        <>
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
          <textarea
            placeholder={tt("prodPhSpecification")}
            rows={3}
            style={{ gridColumn: "1 / -1" }}
            value={form.specification}
            onChange={(e) => setForm({ ...form, specification: e.target.value })}
          />
          {selectedAttributeKeys.length ? (
            <div className="form-grid" style={{ gridColumn: "1 / -1" }}>
              {selectedAttributeKeys.map((key) => (
                <input
                  key={`attr-${key}`}
                  placeholder={key}
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
        </>
      ) : null}

      {formSection === "media" ? (
        <>
          <input
            placeholder={tt("prodPhImageUrl")}
            value={form.imageUrl}
            onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
            style={{ gridColumn: "1 / -1" }}
          />
          <textarea
            placeholder={tt("prodPhGallery")}
            value={form.imageGalleryText}
            onChange={(e) => setForm({ ...form, imageGalleryText: e.target.value })}
            rows={3}
            style={{ gridColumn: "1 / -1" }}
          />
          <textarea
            placeholder={tt("prodPhShortDesc")}
            value={form.shortDescription}
            onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
            rows={2}
            style={{ gridColumn: "1 / -1" }}
          />
          <textarea
            placeholder={tt("prodPhDescription")}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={4}
            style={{ gridColumn: "1 / -1" }}
          />
        </>
      ) : null}

      {formSection === "notes" ? (
        <textarea
          placeholder={tt("prodPhInternalNotes")}
          value={form.internalNotes}
          onChange={(e) => setForm({ ...form, internalNotes: e.target.value })}
          rows={5}
          style={{ gridColumn: "1 / -1" }}
        />
      ) : null}
    </>
  );
}
