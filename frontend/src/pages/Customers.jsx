import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import { notifyError } from "../utils/notify";
import { getLang, t } from "../i18n";

function Customers() {
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

  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    address: "",
    creditLimit: "0",
    birthDate: "",
    marketingOptIn: true,
    priceTier: "RETAIL",
  });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const res = await api.get("/master/customers");
    setCustomers(res.data);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingId) {
        await api.put(`/master/customers/${editingId}`, form);
      } else {
        await api.post("/master/customers", form);
      }
      setForm({ name: "", phone: "", address: "", creditLimit: "0", birthDate: "", marketingOptIn: true, priceTier: "RETAIL" });
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
      creditLimit: String(row.creditLimit ?? 0),
      birthDate: row.birthDate ? String(row.birthDate).slice(0, 10) : "",
      marketingOptIn: row.marketingOptIn == null ? true : Boolean(row.marketingOptIn),
      priceTier: row.priceTier || "RETAIL",
    });
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/master/customers/${row.id}`);
    setSelected(res.data);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ name: "", phone: "", address: "", creditLimit: "0", birthDate: "", marketingOptIn: true, priceTier: "RETAIL" });
  };

  const downloadAccountStatementPdf = async () => {
    if (!selected?.id) return;
    try {
      const res = await api.get(`/master/customers/${selected.id}/account-statement.pdf`, {
        responseType: "blob",
      });
      const blobUrl = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `customer-${selected.id}-statement.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      const msg =
        typeof e.response?.data === "object" &&
        !(e.response.data instanceof Blob) &&
        e.response.data?.error
          ? e.response.data.error
          : tt("custDownloadFailed");
      notifyError(String(msg || tt("custDownloadFailed")));
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("customers")}</div>
          <div className="page-subtitle">{tt("custSubtitle")}</div>
        </div>
      </div>
      <form onSubmit={submit} className="form-grid">
        <input placeholder={tt("colName")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder={tt("colPhone")} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder={tt("colAddress")} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <input
          type="number"
          min={0}
          step={0.01}
          placeholder={tt("custPhCreditLimit")}
          value={form.creditLimit}
          onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
        />
        <input
          type="date"
            title={tt("custBirthDate")}
          value={form.birthDate}
          onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={Boolean(form.marketingOptIn)}
            onChange={(e) => setForm({ ...form, marketingOptIn: e.target.checked })}
          />
          {tt("custMarketingOptIn")}
        </label>
        <select
          className="form-select-sm"
          value={form.priceTier}
          onChange={(e) => setForm({ ...form, priceTier: e.target.value })}
        >
          <option value="RETAIL">{tt("prodPriceTypeRetail")}</option>
          <option value="WHOLESALE">{tt("prodPriceTypeWholesale")}</option>
          <option value="DEALER">{tt("prodPriceTypeDealer")}</option>
        </select>
        <SubmitButton loading={submitting} loadingLabel={editingId ? tt("settingsUpdating") : tt("settingsSaving")}>
          {editingId ? tt("custBtnUpdate") : tt("custBtnAdd")}
        </SubmitButton>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={cancelEdit}>
            {tt("settingsCancel")}
          </button>
        ) : null}
      </form>
      {selected ? (
        <div className="page-card" style={{ marginTop: 12 }}>
          {(() => {
            const creditLimit = Number(selected.creditLimit || 0);
            const due = Number(selected.balance || 0);
            const available = creditLimit > 0 ? Math.max(0, creditLimit - due) : null;
            const usagePercent = creditLimit > 0 ? Math.min(100, (due / creditLimit) * 100) : null;
            return (
              <>
                <h4>{tt("custDetailsTitle")}</h4>
                <p><strong>{tt("colName")}:</strong> {selected.name}</p>
                <p><strong>{tt("colPhone")}:</strong> {selected.phone || "-"}</p>
                <p><strong>{tt("colAddress")}:</strong> {selected.address || "-"}</p>
                <p><strong>{tt("custBirthDate")}:</strong> {selected.birthDate ? new Date(selected.birthDate).toLocaleDateString() : "-"}</p>
                <p><strong>{tt("custMarketing")}:</strong> {selected.marketingOptIn ? tt("custOptedIn") : tt("custOptedOut")}</p>
                <p><strong>{tt("custPriceTier")}:</strong> {selected.priceTier || "RETAIL"}</p>
                <p><strong>{tt("dashDue")}:</strong> ৳{due.toFixed(2)}</p>
                <p><strong>{tt("custCreditLimit")}:</strong> ৳{creditLimit.toFixed(2)} {creditLimit <= 0 ? `(${tt("custNoLimit")})` : ""}</p>
                {creditLimit > 0 ? (
                  <>
                    <p><strong>{tt("custAvailableCredit")}:</strong> ৳{available.toFixed(2)}</p>
                    <p><strong>{tt("custCreditUsage")}:</strong> {usagePercent.toFixed(1)}%</p>
                  </>
                ) : null}
                <p><strong>{tt("custLoyaltyPoints")}:</strong> {Number(selected.loyaltyPoints || 0).toFixed(0)}</p>
                <p><strong>{tt("custLoyaltyTier")}:</strong> {selected.loyaltyTier || tt("custTierRegular")}</p>
                <p><strong>{tt("custTotalSpent")}:</strong> ৳{Number(selected.loyaltyTotalSpent || 0).toFixed(2)}</p>
                <p><strong>{tt("custLastPurchase")}:</strong> {selected.lastPurchaseAt ? new Date(selected.lastPurchaseAt).toLocaleString() : "-"}</p>
                <p><strong>{tt("custDaysSincePurchase")}:</strong> {selected.daysSinceLastPurchase ?? "-"}</p>
                <p><strong>{tt("custDaysUntilBirthday")}:</strong> {selected.daysUntilBirthday ?? "-"}</p>
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={downloadAccountStatementPdf}>
                    {tt("custBtnDownloadStatement")}
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      ) : null}
      <DataTable
        rows={customers}
        searchableKeys={["name", "phone", "address"]}
        columns={[
          { key: "id", label: tt("colId") },
          { key: "name", label: tt("colName") },
          { key: "phone", label: tt("colPhone"), render: (v) => v || "-" },
          { key: "address", label: tt("colAddress"), render: (v) => v || "-" },
          { key: "birthDate", label: tt("custBirthDate"), render: (v) => (v ? new Date(v).toLocaleDateString() : "-") },
          { key: "marketingOptIn", label: tt("custMarketing"), render: (v) => (v ? tt("custYes") : tt("custNo")) },
          { key: "priceTier", label: tt("custPriceTier"), render: (v) => v || "RETAIL" },
          { key: "balance", label: tt("dashDue"), render: (v) => `৳${Number(v).toFixed(2)}` },
          {
            key: "creditLimit",
            label: tt("custCreditCap"),
            render: (v) => (Number(v || 0) > 0 ? `৳${Number(v).toFixed(2)}` : tt("custInfinity")),
          },
          {
            key: "creditRemaining",
            label: tt("custAvailableCredit"),
            render: (_, row) => {
              const creditLimit = Number(row.creditLimit || 0);
              const balance = Number(row.balance || 0);
              if (creditLimit <= 0) return tt("custInfinity");
              return `৳${Math.max(0, creditLimit - balance).toFixed(2)}`;
            },
          },
          {
            key: "creditUsage",
            label: tt("custCreditUsage"),
            render: (_, row) => {
              const creditLimit = Number(row.creditLimit || 0);
              const balance = Number(row.balance || 0);
              if (creditLimit <= 0) return "-";
              return `${Math.min(100, (balance / creditLimit) * 100).toFixed(1)}%`;
            },
          },
          { key: "loyaltyPoints", label: tt("custPoints"), render: (v) => Number(v || 0).toFixed(0) },
          { key: "loyaltyTier", label: tt("custTier"), render: (v) => v || tt("custTierRegular") },
          {
            key: "actions",
            label: tt("colActions"),
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleDetails(row)}>{tt("supBtnDetails")}</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleEdit(row)}>{tt("actionEdit")}</button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default Customers;
