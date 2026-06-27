import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import useServerTable from "../hooks/useServerTable";
import SubmitButton from "../components/SubmitButton";
import SearchSelect from "../components/SearchSelect";
import { getStoredPermissions, hasPermission } from "../utils/permissions";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import { getLang, t } from "../i18n";
import { formatSaleLineQtyDisplay } from "../utils/formatSaleLineQty";

function Prescriptions() {
  const permissions = getStoredPermissions();
  const canManage = hasPermission("pharmacy.manage", permissions);
  const canDispense = hasPermission("pharmacy.dispense", permissions);

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
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [submitting, setSubmitting] = useState(false);
  const emptyForm = {
    patientName: "",
    patientPhone: "",
    doctorName: "",
    notes: "",
    productId: "",
    productVariantId: "",
    qty: "1",
    dosageNote: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [lines, setLines] = useState([]);

  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const fetchRxPage = useCallback(async (q) => {
    const res = await api.get("/pharmacy/prescriptions", {
      params: {
        paged: true,
        status: statusFilterRef.current,
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
  const rxTable = useServerTable(fetchRxPage, {
    pageSize: 10,
    sortKey: "createdAt",
    sortDir: "desc",
  });
  const rows = rxTable.rows;
  const load = rxTable.refresh;

  useEffect(() => {
    api.get("/products?include=variants").then((prodRes) => {
      setProducts(Array.isArray(prodRes.data) ? prodRes.data : []);
    });
  }, []);

  // Re-query (reset to page 1) when the status filter changes.
  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    rxTable.setQuery((prev) => ({ ...prev, page: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const pharmacyProducts = useMemo(
    () => products.filter((p) => p.batchTracked || /pharmacy|medicine|otc|vitamin/i.test(String(p.category || ""))),
    [products]
  );

  const selectedProduct = useMemo(
    () => pharmacyProducts.find((p) => String(p.id) === String(form.productId)) || null,
    [pharmacyProducts, form.productId]
  );

  const addLine = () => {
    const productId = Number(form.productId);
    const qty = Number(form.qty || 0);
    if (!productId || qty <= 0) {
      notifyActionRequired(tt("rxLineRequired"));
      return;
    }
    if (selectedProduct?.hasVariants && !form.productVariantId) {
      notifyActionRequired(tt("posPickVariant"));
      return;
    }
    const variant = (selectedProduct?.variants || []).find(
      (v) => String(v.id) === String(form.productVariantId)
    );
    setLines((prev) => [
      ...prev,
      {
        productId,
        productVariantId: form.productVariantId ? Number(form.productVariantId) : null,
        qty,
        dosageNote: form.dosageNote?.trim() || null,
        productName: selectedProduct?.name || `#${productId}`,
        variantLabel: variant ? variant.label || variant.sku : null,
      },
    ]);
    setForm({ ...form, productId: "", productVariantId: "", qty: "1", dosageNote: "" });
  };

  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const submitPrescription = async (e) => {
    e.preventDefault();
    if (!canManage) {
      notifyActionRequired(tt("rxNeedManagePerm"));
      return;
    }
    const patientName = String(form.patientName || "").trim();
    if (patientName.length < 2) {
      notifyActionRequired(tt("rxPatientRequired"));
      return;
    }
    // Allow submitting with the in-progress draft line if the staged list is empty.
    const allLines = [...lines];
    if (Number(form.productId) && Number(form.qty) > 0) {
      if (selectedProduct?.hasVariants && !form.productVariantId) {
        notifyActionRequired(tt("posPickVariant"));
        return;
      }
      allLines.push({
        productId: Number(form.productId),
        productVariantId: form.productVariantId ? Number(form.productVariantId) : null,
        qty: Number(form.qty),
        dosageNote: form.dosageNote?.trim() || null,
      });
    }
    if (!allLines.length) {
      notifyActionRequired(tt("rxLineRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/pharmacy/prescriptions", {
        patientName,
        patientPhone: form.patientPhone?.trim() || null,
        doctorName: form.doctorName?.trim() || null,
        notes: form.notes?.trim() || null,
        lines: allLines.map((l) => ({
          productId: l.productId,
          productVariantId: l.productVariantId,
          qty: l.qty,
          dosageNote: l.dosageNote,
        })),
      });
      setForm(emptyForm);
      setLines([]);
      await load();
      notifySuccess(tt("rxCreated"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("rxCreateFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRx = async (row) => {
    if (!canManage) return;
    if (!window.confirm(tt("rxCancelConfirm", { name: row.patientName }))) return;
    await api.post(`/pharmacy/prescriptions/${row.id}/cancel`);
    await load();
    notifySuccess(tt("rxCancelled"));
  };

  const dispenseAtPos = (row) => {
    if (!canDispense) {
      notifyActionRequired(tt("rxNeedDispensePerm"));
      return;
    }
    localStorage.setItem("bd_pos_load_prescription_id", String(row.id));
    window.location.hash = "pos";
    window.dispatchEvent(new CustomEvent("bd_pos_load_prescription"));
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("rxTitle")}</div>
          <div className="page-subtitle">{tt("rxSubtitle")}</div>
        </div>
      </div>

      <div className="form-grid" style={{ marginBottom: 12, maxWidth: 420 }}>
        <SearchSelect
          className="form-select-sm"
          value={statusFilter}
          onChange={(val) => setStatusFilter(val || "OPEN")}
          options={[
            { value: "OPEN", label: tt("rxStatusOpen") },
            { value: "PARTIAL", label: "Partially dispensed" },
            { value: "DISPENSED", label: tt("rxStatusDispensed") },
            { value: "CANCELLED", label: tt("rxStatusCancelled") },
            { value: "ALL", label: tt("posDeptAll") },
          ]}
          isClearable={false}
        />
      </div>

      {canManage ? (
        <form onSubmit={submitPrescription} className="page-card form-grid" style={{ marginBottom: 16 }}>
          <h4 style={{ margin: 0, gridColumn: "1 / -1" }}>{tt("rxNewTitle")}</h4>
          <input
            placeholder={tt("rxPatientName")}
            value={form.patientName}
            onChange={(e) => setForm({ ...form, patientName: e.target.value })}
            required
          />
          <input
            placeholder={tt("rxPatientPhone")}
            value={form.patientPhone}
            onChange={(e) => setForm({ ...form, patientPhone: e.target.value })}
          />
          <input
            placeholder={tt("rxDoctorName")}
            value={form.doctorName}
            onChange={(e) => setForm({ ...form, doctorName: e.target.value })}
          />
          <SearchSelect
            className="form-select-sm"
            value={form.productId}
            onChange={(val) =>
              setForm({
                ...form,
                productId: val,
                productVariantId: "",
              })
            }
            placeholder={tt("rxSelectMedicine")}
            options={pharmacyProducts.map((p) => ({
              value: String(p.id),
              label: `${p.name}${p.category ? ` (${p.category})` : ""}`,
            }))}
          />
          {selectedProduct?.hasVariants ? (
            <SearchSelect
              className="form-select-sm"
              value={form.productVariantId}
              onChange={(val) => setForm({ ...form, productVariantId: val })}
              placeholder={tt("posPickVariant")}
              options={(selectedProduct.variants || []).map((v) => ({
                value: String(v.id),
                label: v.label || v.sku || `#${v.id}`,
              }))}
            />
          ) : null}
          <input
            type="number"
            min={0.01}
            step={0.01}
            placeholder={tt("receiptQty")}
            value={form.qty}
            onChange={(e) => setForm({ ...form, qty: e.target.value })}
          />
          <input
            placeholder={tt("rxDosageNote")}
            value={form.dosageNote}
            onChange={(e) => setForm({ ...form, dosageNote: e.target.value })}
          />
          <button type="button" className="btn-secondary" onClick={addLine} style={{ alignSelf: "start" }}>
            + {tt("rxColItems") || "Add line"}
          </button>

          {lines.length ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>{tt("rxSelectMedicine")}</th>
                    <th>{tt("receiptQty")}</th>
                    <th>{tt("rxDosageNote")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={`${l.productId}-${idx}`}>
                      <td>
                        {l.productName}
                        {l.variantLabel ? ` (${l.variantLabel})` : ""}
                      </td>
                      <td>{l.qty}</td>
                      <td>{l.dosageNote || "-"}</td>
                      <td>
                        <button type="button" className="btn-danger btn-sm" onClick={() => removeLine(idx)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <textarea
            placeholder={tt("rxNotes")}
            rows={2}
            style={{ gridColumn: "1 / -1" }}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <SubmitButton loading={submitting} loadingLabel={tt("settingsSaving")}>
            {tt("rxSave")}
          </SubmitButton>
        </form>
      ) : null}

      <DataTable
        title={tt("rxListTitle", { n: rxTable.total })}
        rows={rows}
        serverMode
        totalRows={rxTable.total}
        loading={rxTable.loading}
        onQueryChange={rxTable.onQueryChange}
        initialSort="createdAt"
        initialSortDir="desc"
        pageSize={10}
        columns={[
          { key: "prescriptionNo", label: tt("rxColNo"), render: (v) => v || "-" },
          { key: "patientName", label: tt("rxPatientName") },
          { key: "patientPhone", label: tt("rxPatientPhone"), render: (v) => v || "-" },
          { key: "doctorName", label: tt("rxDoctorName"), render: (v) => v || "-" },
          {
            key: "status",
            label: tt("colStatus"),
            searchable: false,
            render: (v) => (
              <span
                className={`badge ${
                  v === "DISPENSED"
                    ? "badge-success"
                    : v === "CANCELLED"
                      ? "badge-danger"
                      : v === "PARTIAL"
                        ? "badge-info"
                        : "badge-warning"
                }`}
              >
                {v}
              </span>
            ),
          },
          {
            key: "lines",
            label: tt("rxColItems"),
            searchable: false,
            render: (v) =>
              Array.isArray(v) && v.length
                ? v
                    .map((l) => {
                      const dispensed = Number(l.dispensedQty || 0);
                      const progress = dispensed > 0 ? ` [${dispensed}/${l.qty}]` : "";
                      return `${l.product?.name || l.productId} × ${formatSaleLineQtyDisplay(
                        { qty: l.qty, saleUnit: l.product?.saleUnit || "TABLET" },
                        tt
                      )}${progress}`;
                    })
                    .join(", ")
                : "-",
          },
          {
            key: "actions",
            label: tt("colActions"),
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["OPEN", "PARTIAL"].includes(row.status) && canDispense ? (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => dispenseAtPos(row)}>
                    {row.status === "PARTIAL" ? "Refill at POS" : tt("rxDispensePos")}
                  </button>
                ) : null}
                {row.status === "OPEN" && canManage ? (
                  <button type="button" className="btn-danger btn-sm" onClick={() => cancelRx(row)}>
                    {tt("rxCancel")}
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default Prescriptions;
