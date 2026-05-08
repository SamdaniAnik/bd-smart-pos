import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import { formatBDT } from "../utils/currency";
import { notifyActionRequired } from "../utils/notify";

const lang = () =>
  typeof window !== "undefined" && localStorage.getItem("bd_pos_lang") === "bn" ? "bn" : "en";
const bdt = (v) => formatBDT(v, { lang: lang(), decimals: 2 });

function DueCollection() {
  const [summary, setSummary] = useState({ customers: [], suppliers: [], purchaseBankLoans: null });
  const [customerCollections, setCustomerCollections] = useState([]);
  const [supplierPayments, setSupplierPayments] = useState([]);
  const [outstandingLoans, setOutstandingLoans] = useState({ purchases: [], totalOutstanding: 0 });
  const [taxCategories, setTaxCategories] = useState([]);
  const [customerForm, setCustomerForm] = useState({
    customerId: "",
    amount: "",
    method: "Cash",
    note: "",
    fundingAccountCode: "",
  });
  const [supplierForm, setSupplierForm] = useState({
    supplierId: "",
    amount: "",
    method: "Cash",
    note: "",
    taxCategoryOverride: "",
    aitRateOverride: "",
    vdsRateOverride: "",
    withholdingNote: "",
    fundingAccountCode: "",
  });
  const [loanForm, setLoanForm] = useState({
    purchaseId: "",
    amount: "",
    method: "Cash",
    note: "",
    fundingAccountCode: "",
  });
  const [submittingLoan, setSubmittingLoan] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [submittingSupplier, setSubmittingSupplier] = useState(false);
  const [submittingCustomer, setSubmittingCustomer] = useState(false);

  const branchIdForFiscal = typeof window !== "undefined" ? localStorage.getItem("bd_pos_branch_id") || "1" : "1";
  const { data: fiscalGateData } = useQuery({
    queryKey: ["fiscal-gate", branchIdForFiscal],
    queryFn: async () => (await api.get("/fiscal/fiscal-period-status")).data,
    staleTime: 45_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const fiscalBlocked = Boolean(fiscalGateData && fiscalGateData.ok === false);

  const load = async () => {
    const [summaryRes, cRes, sRes, taxRes, loansRes] = await Promise.all([
      api.get("/dues/summary"),
      api.get("/dues/customer-collections"),
      api.get("/dues/supplier-payments"),
      api.get("/withholding/tax-categories"),
      api.get("/purchases/outstanding-loans"),
    ]);
    setSummary(summaryRes.data);
    setCustomerCollections(cRes.data);
    setSupplierPayments(sRes.data);
    setTaxCategories(taxRes.data?.categories || []);
    setOutstandingLoans(
      loansRes.data || {
        purchases: [],
        totalOutstanding: 0,
      }
    );
  };

  useEffect(() => {
    load();
  }, []);

  const selectedSupplier = useMemo(
    () => summary.suppliers.find((s) => String(s.id) === String(supplierForm.supplierId)) || null,
    [summary.suppliers, supplierForm.supplierId]
  );

  // Live withholding preview whenever the form changes meaningfully.
  useEffect(() => {
    let cancelled = false;
    const supId = Number(supplierForm.supplierId);
    const amt = Number(supplierForm.amount);
    if (!supId || !amt || amt <= 0) {
      setPreview(null);
      setPreviewError("");
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const body = { supplierId: supId, amount: amt };
        if (supplierForm.taxCategoryOverride && supplierForm.taxCategoryOverride !== "DEFAULT") {
          body.taxCategory = supplierForm.taxCategoryOverride;
        }
        if (supplierForm.aitRateOverride !== "" && !Number.isNaN(Number(supplierForm.aitRateOverride))) {
          body.aitRate = Number(supplierForm.aitRateOverride);
        }
        if (supplierForm.vdsRateOverride !== "" && !Number.isNaN(Number(supplierForm.vdsRateOverride))) {
          body.vdsRate = Number(supplierForm.vdsRateOverride);
        }
        const res = await api.post("/withholding/preview-payment", body);
        if (!cancelled) {
          setPreview(res.data);
          setPreviewError("");
        }
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(err?.response?.data?.error || err?.message || "Preview failed");
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    supplierForm.supplierId,
    supplierForm.amount,
    supplierForm.taxCategoryOverride,
    supplierForm.aitRateOverride,
    supplierForm.vdsRateOverride,
  ]);

  const submitCustomerCollection = async (e) => {
    e.preventDefault();
    if (fiscalBlocked) {
      notifyActionRequired(fiscalGateData?.message || "No open fiscal period for today.");
      return;
    }
    setSubmittingCustomer(true);
    try {
      await api.post("/dues/customer-collections", {
        customerId: Number(customerForm.customerId),
        amount: Number(customerForm.amount),
        method: customerForm.method,
        note: customerForm.note || null,
        fundingAccountCode: customerForm.fundingAccountCode?.trim() || undefined,
      });
      setCustomerForm({ customerId: "", amount: "", method: "Cash", note: "", fundingAccountCode: "" });
      await load();
    } finally {
      setSubmittingCustomer(false);
    }
  };

  const submitSupplierPayment = async (e) => {
    e.preventDefault();
    if (fiscalBlocked) {
      notifyActionRequired(fiscalGateData?.message || "No open fiscal period for today.");
      return;
    }
    setSubmittingSupplier(true);
    try {
      const body = {
        supplierId: Number(supplierForm.supplierId),
        amount: Number(supplierForm.amount),
        method: supplierForm.method,
        note: supplierForm.note || null,
      };
      if (supplierForm.taxCategoryOverride && supplierForm.taxCategoryOverride !== "DEFAULT") {
        body.taxCategory = supplierForm.taxCategoryOverride;
      }
      if (supplierForm.aitRateOverride !== "" && !Number.isNaN(Number(supplierForm.aitRateOverride))) {
        body.aitRate = Number(supplierForm.aitRateOverride);
      }
      if (supplierForm.vdsRateOverride !== "" && !Number.isNaN(Number(supplierForm.vdsRateOverride))) {
        body.vdsRate = Number(supplierForm.vdsRateOverride);
      }
      if (supplierForm.withholdingNote) body.withholdingNote = supplierForm.withholdingNote;
      if (supplierForm.fundingAccountCode?.trim()) body.fundingAccountCode = supplierForm.fundingAccountCode.trim();
      await api.post("/withholding/pay-supplier", body);
      setSupplierForm({
        supplierId: "",
        amount: "",
        method: "Cash",
        note: "",
        taxCategoryOverride: "",
        aitRateOverride: "",
        vdsRateOverride: "",
        withholdingNote: "",
        fundingAccountCode: "",
      });
      setPreview(null);
      load();
    } finally {
      setSubmittingSupplier(false);
    }
  };

  const submitLoanPayment = async (e) => {
    e.preventDefault();
    if (fiscalBlocked) {
      notifyActionRequired(fiscalGateData?.message || "No open fiscal period for today.");
      return;
    }
    const pid = Number(loanForm.purchaseId);
    if (!pid) return;
    setSubmittingLoan(true);
    try {
      const body = {
        amount: Number(loanForm.amount),
        method: loanForm.method,
        note: loanForm.note || null,
      };
      if (loanForm.fundingAccountCode?.trim()) body.fundingAccountCode = loanForm.fundingAccountCode.trim();
      await api.post(`/purchases/${pid}/loan-payment`, body);
      setLoanForm({ purchaseId: "", amount: "", method: "Cash", note: "", fundingAccountCode: "" });
      await load();
    } finally {
      setSubmittingLoan(false);
    }
  };

  const downloadMushak66 = async (voucherId) => {
    try {
      const res = await api.get(`/withholding/vouchers/${voucherId}/mushak66.pdf`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mushak-6.6-${voucherId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Download failed";
      alert(msg);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Due collection & settlement</div>
          <div className="page-subtitle">
            Customer receipts, supplier AP (with withholding), and purchase bank-loan repayment (cash or bank GL)
          </div>
        </div>
      </div>

      {fiscalBlocked ? (
        <div className="page-card fiscal-banner">
          <strong>Fiscal period — collections blocked</strong>
          <p>{fiscalGateData?.message || "No open fiscal period for today."}</p>
        </div>
      ) : null}

      {summary.purchaseBankLoans != null ? (
        <div className="page-card" style={{ marginTop: 8, padding: 12, background: "#f8fafc" }}>
          <strong>Purchase bank loans outstanding</strong>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {summary.purchaseBankLoans.count || 0} purchase(s) · Total {bdt(summary.purchaseBankLoans.totalOutstanding || 0)} (posts to Bank
            Loans Payable 2320 — not supplier payable)
          </p>
        </div>
      ) : null}

      <h4 style={{ marginTop: 8 }}>Collect customer due</h4>
      <form onSubmit={submitCustomerCollection} className="form-grid">
        <select
          className="form-select-sm"
          value={customerForm.customerId}
          onChange={(e) => setCustomerForm({ ...customerForm, customerId: e.target.value })}
          required
        >
          <option value="">Select Customer</option>
          {summary.customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (Due: {bdt(c.balance || 0)})
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Amount"
          value={customerForm.amount}
          onChange={(e) => setCustomerForm({ ...customerForm, amount: e.target.value })}
          required
        />
        <select className="form-select-sm" value={customerForm.method} onChange={(e) => setCustomerForm({ ...customerForm, method: e.target.value })}>
          <option value="Cash">Cash</option>
          <option value="Bank">Bank</option>
          <option value="bKash">bKash</option>
          <option value="Nagad">Nagad</option>
          <option value="Card">Card</option>
        </select>
        <input
          placeholder="GL code override (e.g. 1130 for bank)"
          value={customerForm.fundingAccountCode}
          onChange={(e) => setCustomerForm({ ...customerForm, fundingAccountCode: e.target.value })}
          title="Optional. Defaults: Cash → 1100, Bank → 1130"
        />
        <input
          placeholder="Note (optional)"
          value={customerForm.note}
          onChange={(e) => setCustomerForm({ ...customerForm, note: e.target.value })}
        />
        <SubmitButton loading={submittingCustomer} loadingLabel="Recording…">
          Collect due
        </SubmitButton>
      </form>

      <h4 style={{ marginTop: 20 }}>Repay purchase bank loan</h4>
      <p className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
        For purchases created with financing <strong>Bank loan</strong>: pay down principal from cash (1100) or bank (1130). Does not change
        supplier payable.
      </p>
      <form onSubmit={submitLoanPayment} className="form-grid">
        <select
          className="form-select-sm"
          value={loanForm.purchaseId}
          onChange={(e) => setLoanForm({ ...loanForm, purchaseId: e.target.value })}
          required
        >
          <option value="">
            {outstandingLoans.purchases?.length ? "Select purchase with loan balance" : "No outstanding purchase loans"}
          </option>
          {(outstandingLoans.purchases || []).map((p) => (
            <option key={p.id} value={p.id}>
              #{p.id} {p.supplier?.name ? `· ${p.supplier.name}` : ""} · Due {bdt(p.dueAmount || 0)}
              {p.invoiceNo ? ` · ${p.invoiceNo}` : ""}
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Amount"
          value={loanForm.amount}
          onChange={(e) => setLoanForm({ ...loanForm, amount: e.target.value })}
          required
        />
        <select className="form-select-sm" value={loanForm.method} onChange={(e) => setLoanForm({ ...loanForm, method: e.target.value })}>
          <option value="Cash">Cash (GL 1100)</option>
          <option value="Bank">Bank (GL 1130)</option>
        </select>
        <input
          placeholder="GL code override (optional)"
          value={loanForm.fundingAccountCode}
          onChange={(e) => setLoanForm({ ...loanForm, fundingAccountCode: e.target.value })}
        />
        <input placeholder="Note (optional)" value={loanForm.note} onChange={(e) => setLoanForm({ ...loanForm, note: e.target.value })} />
        <SubmitButton loading={submittingLoan} loadingLabel="Posting…">
          Pay loan
        </SubmitButton>
      </form>

      <h4 style={{ marginTop: 16 }}>Pay Supplier Due (with AIT / VDS withholding)</h4>
      <form onSubmit={submitSupplierPayment} className="form-grid">
        <select
          className="form-select-sm"
          value={supplierForm.supplierId}
          onChange={(e) => setSupplierForm({ ...supplierForm, supplierId: e.target.value })}
          required
        >
          <option value="">Select Supplier</option>
          {summary.suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} (Payable: {bdt(s.payableBalance || 0)})
              {s.taxCategory ? ` · ${s.taxCategory}` : ""}
              {s.withholdingExempt ? " · EXEMPT" : ""}
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Gross amount"
          value={supplierForm.amount}
          onChange={(e) => setSupplierForm({ ...supplierForm, amount: e.target.value })}
          required
        />
        <select className="form-select-sm" value={supplierForm.method} onChange={(e) => setSupplierForm({ ...supplierForm, method: e.target.value })}>
          <option value="Cash">Cash</option>
          <option value="Bank">Bank</option>
          <option value="bKash">bKash</option>
          <option value="Nagad">Nagad</option>
          <option value="Card">Card</option>
        </select>
        <select
          className="form-select-sm"
          value={supplierForm.taxCategoryOverride}
          onChange={(e) => setSupplierForm({ ...supplierForm, taxCategoryOverride: e.target.value, aitRateOverride: "", vdsRateOverride: "" })}
          title="Override the supplier's default tax category for this single payment"
        >
          <option value="">Use supplier default</option>
          {taxCategories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.1"
          placeholder="AIT rate % (override)"
          value={supplierForm.aitRateOverride}
          onChange={(e) => setSupplierForm({ ...supplierForm, aitRateOverride: e.target.value })}
        />
        <input
          type="number"
          step="0.1"
          placeholder="VDS rate % (override)"
          value={supplierForm.vdsRateOverride}
          onChange={(e) => setSupplierForm({ ...supplierForm, vdsRateOverride: e.target.value })}
        />
        <input
          placeholder="Payment note (optional)"
          value={supplierForm.note}
          onChange={(e) => setSupplierForm({ ...supplierForm, note: e.target.value })}
        />
        <input
          placeholder="GL code override (optional)"
          value={supplierForm.fundingAccountCode}
          onChange={(e) => setSupplierForm({ ...supplierForm, fundingAccountCode: e.target.value })}
          title="Overrides cash/bank account for journal. Defaults: Cash → 1100, Bank → 1130"
        />
        <input
          placeholder="Withholding note (e.g. challan ref)"
          value={supplierForm.withholdingNote}
          onChange={(e) => setSupplierForm({ ...supplierForm, withholdingNote: e.target.value })}
        />
        <SubmitButton loading={submittingSupplier} loadingLabel="Posting payment…">
          Pay supplier
        </SubmitButton>
      </form>

      {preview ? (
        <div
          className="page-card"
          style={{
            marginTop: 8,
            padding: 12,
            background:
              preview.aitAmount > 0 || preview.vdsAmount > 0 ? "#eff6ff" : "#f1f5f9",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
          }}
        >
          <strong style={{ marginBottom: 6, display: "block" }}>
            Withholding preview ({preview.rates.source}{preview.rates.category ? ` · ${preview.rates.category}` : ""})
          </strong>
          <div className="quick-stats" style={{ marginTop: 4 }}>
            <div className="stat">Gross: {bdt(preview.gross)}</div>
            <div className="stat">AIT @ {Number(preview.rates.aitRate).toFixed(2)}%: {bdt(preview.aitAmount)}</div>
            <div className="stat">VDS @ {Number(preview.rates.vdsRate).toFixed(2)}%: {bdt(preview.vdsAmount)}</div>
            <div className="stat" style={{ background: "#dcfce7" }}>
              Net cash out: {bdt(preview.netPaid)}
            </div>
          </div>
          {preview.aitAmount > 0 || preview.vdsAmount > 0 ? (
            <p className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
              On submit, a Mushak 6.6 certificate will be generated automatically.
              Journal will post: DR Accounts Payable {bdt(preview.gross)}; CR Cash {bdt(preview.netPaid)};
              {preview.aitAmount > 0 ? ` CR AIT-NBR ${bdt(preview.aitAmount)};` : ""}
              {preview.vdsAmount > 0 ? ` CR VDS-NBR ${bdt(preview.vdsAmount)};` : ""}
            </p>
          ) : (
            <p className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
              No withholding applies (supplier is exempt or no tax category is set).
            </p>
          )}
        </div>
      ) : null}
      {previewError ? <p style={{ color: "#b42318" }}>{previewError}</p> : null}
      {selectedSupplier && !selectedSupplier.taxCategory && !selectedSupplier.withholdingExempt ? (
        <p className="text-muted" style={{ marginTop: 4, fontSize: 12 }}>
          Supplier has no tax category set — withholding will default to 0/0 unless overridden above.
          Edit the supplier in the Suppliers page to set a default category.
        </p>
      ) : null}

      <DataTable
        title="Customer Collections"
        rows={customerCollections.map((x) => ({
          ...x,
          customerName: x.customer?.name || "-",
          createdAtLabel: new Date(x.createdAt).toLocaleString(),
        }))}
        searchableKeys={["customerName", "method", "note", "createdAtLabel"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "createdAtLabel", label: "Date" },
          { key: "customerName", label: "Customer" },
          { key: "amount", label: "Amount", render: (v) => bdt(v) },
          { key: "method", label: "Method" },
          { key: "note", label: "Note", render: (v) => v || "-" },
        ]}
      />

      <DataTable
        title="Supplier Payments"
        rows={supplierPayments.map((x) => ({
          ...x,
          supplierName: x.supplier?.name || "-",
          createdAtLabel: new Date(x.createdAt).toLocaleString(),
          mushakLabel: x.mushak66DocumentNo || "—",
        }))}
        searchableKeys={["supplierName", "method", "note", "createdAtLabel", "mushakLabel", "taxCategory"]}
        columns={[
          { key: "id", label: "ID" },
          { key: "createdAtLabel", label: "Date" },
          { key: "supplierName", label: "Supplier" },
          { key: "amount", label: "Gross", render: (v) => bdt(v) },
          { key: "aitAmount", label: "AIT", render: (v) => (Number(v) > 0 ? bdt(v) : "—") },
          { key: "vdsAmount", label: "VDS", render: (v) => (Number(v) > 0 ? bdt(v) : "—") },
          { key: "netPaid", label: "Net", render: (v, row) => bdt(v != null ? v : Number(row.amount || 0) - Number(row.aitAmount || 0) - Number(row.vdsAmount || 0)) },
          { key: "method", label: "Method" },
          { key: "mushakLabel", label: "Mushak 6.6" },
          {
            key: "actions",
            label: "Cert",
            render: (_v, row) =>
              Number(row.aitAmount || 0) > 0 || Number(row.vdsAmount || 0) > 0 ? (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => downloadMushak66(row.id)}
                >
                  PDF
                </button>
              ) : (
                "—"
              ),
          },
        ]}
      />
    </div>
  );
}

export default DueCollection;
