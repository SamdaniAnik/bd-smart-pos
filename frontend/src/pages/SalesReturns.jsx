import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import { notifySuccess } from "../utils/notify";
import { getLang, t } from "../i18n";

function SalesReturns() {
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

  const [sales, setSales] = useState([]);
  const [productsBySale, setProductsBySale] = useState([]);
  const [form, setForm] = useState({ saleId: "", productId: "", qty: "", reason: "", managerApprovalPin: "" });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const res = await api.get("/sales/recent");
    setSales(res.data);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const selectedSale = sales.find((s) => String(s.id) === String(form.saleId));
    if (!selectedSale) {
      setProductsBySale([]);
      return;
    }
    setProductsBySale(selectedSale.items || []);
  }, [form.saleId, sales]);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post(`/sales/${Number(form.saleId)}/return`, {
        reason: form.reason,
        items: [{ productId: Number(form.productId), qty: Number(form.qty) }],
        managerApprovalPin: form.managerApprovalPin,
      });
      setForm({ saleId: "", productId: "", qty: "", reason: "", managerApprovalPin: "" });
      await load();
      notifySuccess(tt("srSuccessCreated"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Sales returns</div>
          <div className="page-title">{tt("srTitle")}</div>
          <div className="page-subtitle">{tt("srSubtitle")}</div>
        </div>
      </div>
      <form onSubmit={submit} className="form-grid">
        <select className="form-select-sm" value={form.saleId} onChange={(e) => setForm({ ...form, saleId: e.target.value, productId: "" })}>
          <option value="">{tt("srPhSelectSale")}</option>
          {sales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.invoiceNo || tt("srSaleNum", { n: s.id })}
            </option>
          ))}
        </select>
        <select className="form-select-sm" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
          <option value="">{tt("srPhSelectProduct")}</option>
          {productsBySale.map((i) => (
            <option key={i.productId} value={i.productId}>
              {tt("srProductOption", { id: i.productId, qty: i.qty })}
            </option>
          ))}
        </select>
        <input placeholder={tt("receiptQty")} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        <input placeholder={tt("invColReason")} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <input
          placeholder={tt("srPhManagerPin")}
          value={form.managerApprovalPin}
          onChange={(e) => setForm({ ...form, managerApprovalPin: e.target.value })}
        />
        <SubmitButton loading={submitting} loadingLabel={tt("srCreatingReturn")}>
          {tt("srBtnCreate")}
        </SubmitButton>
      </form>
      <DataTable
        rows={sales.map((s) => ({ ...s, itemsCount: s.items?.length || 0 }))}
        searchableKeys={["invoiceNo"]}
        columns={[
          { key: "id", label: tt("srColSaleId") },
          { key: "invoiceNo", label: tt("receiptInvoice"), render: (v) => v || "-" },
          { key: "total", label: tt("receiptTotal"), render: (v) => `৳${Number(v).toFixed(2)}` },
          { key: "itemsCount", label: tt("srColItems") },
        ]}
      />
    </div>
  );
}

export default SalesReturns;
