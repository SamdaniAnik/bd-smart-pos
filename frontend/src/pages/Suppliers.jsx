import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import { formatBDT } from "../utils/currency";
import { getLang, t } from "../i18n";

const EMPTY_FORM = {
  name: "",
  phone: "",
  address: "",
  tinNumber: "",
  binNumber: "",
  taxCategory: "",
  withholdingExempt: false,
  withholdingNote: "",
};

function Suppliers() {
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
  const bdt = (v) => formatBDT(v, { lang: uiLang, decimals: 2 });

  const [suppliers, setSuppliers] = useState([]);
  const [taxCategories, setTaxCategories] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const [supRes, taxRes] = await Promise.all([
      api.get("/master/suppliers"),
      api.get("/withholding/tax-categories"),
    ]);
    setSuppliers(supRes.data);
    setTaxCategories(taxRes.data?.categories || []);
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const payload = { ...form };
    // Send empty strings as nulls to clear fields cleanly server-side.
    for (const k of Object.keys(payload)) {
      if (payload[k] === "") payload[k] = null;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        await api.put(`/master/suppliers/${editingId}`, payload);
      } else {
        await api.post("/master/suppliers", payload);
      }
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      setSelected(null);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setSelected(row);
    setForm({
      name: row.name || "",
      phone: row.phone || "",
      address: row.address || "",
      tinNumber: row.tinNumber || "",
      binNumber: row.binNumber || "",
      taxCategory: row.taxCategory || "",
      withholdingExempt: Boolean(row.withholdingExempt),
      withholdingNote: row.withholdingNote || "",
    });
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/master/suppliers/${row.id}`);
    setSelected(res.data);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  };

  const handleDelete = async (row) => {
    if (!window.confirm(tt("supConfirmDelete", { name: row.name }))) return;
    await api.delete(`/master/suppliers/${row.id}`);
    if (selected?.id === row.id) setSelected(null);
    if (editingId === row.id) {
      setEditingId(null);
      setForm({ ...EMPTY_FORM });
    }
    load();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Suppliers</div>
          <div className="page-title">{tt("suppliers")}</div>
          <div className="page-subtitle">{tt("supSubtitle")}</div>
        </div>
      </div>
      <form onSubmit={submit} className="form-grid">
        <input placeholder={tt("colName")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input placeholder={tt("colPhone")} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder={tt("colAddress")} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <input
          placeholder={tt("supPhTin")}
          value={form.tinNumber}
          maxLength={32}
          onChange={(e) => setForm({ ...form, tinNumber: e.target.value })}
        />
        <input
          placeholder={tt("supPhBin")}
          value={form.binNumber}
          maxLength={32}
          onChange={(e) => setForm({ ...form, binNumber: e.target.value })}
        />
        <select
          className="form-select-sm"
          value={form.taxCategory}
          onChange={(e) => setForm({ ...form, taxCategory: e.target.value })}
          title={tt("supTaxCategoryTitle")}
        >
          <option value="">{tt("supNoDefaultTaxCat")}</option>
          {taxCategories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.withholdingExempt}
            onChange={(e) => setForm({ ...form, withholdingExempt: e.target.checked })}
          />
          {tt("supWithholdingExempt")}
        </label>
        <input
          placeholder={tt("supPhWithholdingNote")}
          value={form.withholdingNote}
          onChange={(e) => setForm({ ...form, withholdingNote: e.target.value })}
        />
        <SubmitButton loading={submitting} loadingLabel={editingId ? tt("settingsUpdating") : tt("settingsSaving")}>
          {editingId ? tt("supBtnUpdate") : tt("supBtnAdd")}
        </SubmitButton>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={cancelEdit}>
            {tt("settingsCancel")}
          </button>
        ) : null}
      </form>
      {selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          <h4>{tt("supDetailsTitle")}</h4>
          <p><strong>{tt("colName")}:</strong> {selected.name}</p>
          <p><strong>{tt("colPhone")}:</strong> {selected.phone || "-"}</p>
          <p><strong>{tt("colAddress")}:</strong> {selected.address || "-"}</p>
          <p><strong>{tt("supPayable")}:</strong> {bdt(selected.payableBalance || 0)}</p>
          <p><strong>{tt("supTin")}:</strong> {selected.tinNumber || "-"}    <strong style={{ marginLeft: 12 }}>{tt("supBin")}:</strong> {selected.binNumber || "-"}</p>
          <p><strong>{tt("supTaxCategory")}:</strong> {selected.taxCategory || "-"}{selected.withholdingExempt ? ` (${tt("supExempt")})` : ""}</p>
          {selected.withholdingNote ? <p><strong>{tt("supWithholdingNote")}:</strong> {selected.withholdingNote}</p> : null}
        </div>
      ) : null}
      <DataTable
        rows={suppliers}
        searchableKeys={["name", "phone", "address", "tinNumber", "binNumber", "taxCategory"]}
        columns={[
          { key: "id", label: tt("colId") },
          { key: "name", label: tt("colName") },
          { key: "phone", label: tt("colPhone"), render: (v) => v || "-" },
          { key: "tinNumber", label: tt("supTin"), render: (v) => v || "-" },
          { key: "taxCategory", label: tt("supTaxCatShort"), render: (v, row) => (row.withholdingExempt ? tt("supExempt") : v || "-") },
          { key: "payableBalance", label: tt("supPayable"), render: (v) => bdt(v) },
          {
            key: "actions",
            label: tt("colActions"),
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleDetails(row)}>{tt("supBtnDetails")}</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleEdit(row)}>{tt("actionEdit")}</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(row)}>{tt("actionDelete")}</button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default Suppliers;
