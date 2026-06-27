import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import { formatBDT } from "../utils/currency";
import { notifyActionRequired, notifyPermissionRequired, notifySuccess, notifyError } from "../utils/notify";
import { getLang, t } from "../i18n";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import SearchSelect from "../components/SearchSelect";

const lang = () =>
  typeof window !== "undefined" && localStorage.getItem("bd_pos_lang") === "bn" ? "bn" : "en";
const bdt = (v) => formatBDT(v, { lang: lang(), decimals: 2 });

function DueCollection() {
  const tt = useMemo(() => (key, params) => t(lang(), key, params), []);
  const { hasPermission } = usePermissions();
  const canCollectCustomer = hasPermission("customer.create");
  const canPaySupplier = hasPermission("supplier.create");
  const canPayLoan = hasPermission("purchase.create");

  const requireCustomerCreate = () => {
    if (canCollectCustomer) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "customer.create" }));
    return false;
  };
  const requireSupplierCreate = () => {
    if (canPaySupplier) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "supplier.create" }));
    return false;
  };
  const requirePurchaseCreate = () => {
    if (canPayLoan) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "purchase.create" }));
    return false;
  };

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
    mfsTrxId: "",
  });
  const [mfsSession, setMfsSession] = useState(null);
  const [initiatingMfs, setInitiatingMfs] = useState(false);
  const MFS_METHODS = ["bKash", "Nagad", "Rocket", "Upay"];
  const isMfsMethod = (m) => MFS_METHODS.includes(String(m || ""));
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
  const [sendingReminders, setSendingReminders] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [submittingSupplier, setSubmittingSupplier] = useState(false);
  const [submittingCustomer, setSubmittingCustomer] = useState(false);
  const [bakirKhata, setBakirKhata] = useState(null);
  const [loadingBakir, setLoadingBakir] = useState(false);
  const [sendingBakirStatement, setSendingBakirStatement] = useState(false);

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

  useEffect(() => {
    const cid = customerForm.customerId;
    if (!cid) {
      setBakirKhata(null);
      return undefined;
    }
    let cancelled = false;
    setLoadingBakir(true);
    api
      .get(`/dues/bakir-khata/${cid}`)
      .then((res) => {
        if (!cancelled) setBakirKhata(res.data);
      })
      .catch(() => {
        if (!cancelled) setBakirKhata(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingBakir(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerForm.customerId]);

  const bakirEntryLabel = (entryType) => {
    const key = {
      SALE_CREDIT: "bakirEntrySaleCredit",
      COLLECTION: "bakirEntryCollection",
      ADJUSTMENT: "bakirEntryAdjustment",
    }[entryType];
    return key ? tt(key) : entryType;
  };

  const initiateCustomerMfs = async () => {
    if (!requireCustomerCreate()) return;
    const amt = Number(customerForm.amount);
    if (!(amt > 0)) {
      notifyError("Enter the collection amount before initiating MFS payment");
      return;
    }
    setInitiatingMfs(true);
    try {
      const res = await api.post("/payments/mfs/initiate", {
        method: customerForm.method,
        amount: amt,
        invoiceRef: `DUE-${customerForm.customerId || "X"}-${Date.now()}`,
      });
      setMfsSession(res.data);
      notifySuccess(
        res.data?.provider === "log"
          ? "MFS session created (simulated — enter any valid-format TrxID)"
          : "MFS session created — ask the customer to pay, then enter the TrxID"
      );
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || "Failed to start MFS payment");
    } finally {
      setInitiatingMfs(false);
    }
  };

  const submitCustomerCollection = async (e) => {
    e.preventDefault();
    if (!requireCustomerCreate()) return;
    if (fiscalBlocked) {
      notifyActionRequired(fiscalGateData?.message || "No open fiscal period for today.");
      return;
    }
    const usingMfs = isMfsMethod(customerForm.method);
    if (usingMfs && !mfsSession?.paymentId) {
      notifyActionRequired("Initiate the MFS payment first, then enter the TrxID");
      return;
    }
    if (usingMfs && !String(customerForm.mfsTrxId || "").trim()) {
      notifyActionRequired("Enter the MFS TrxID to verify the payment");
      return;
    }
    setSubmittingCustomer(true);
    try {
      const cid = customerForm.customerId;
      await api.post("/dues/customer-collections", {
        customerId: Number(cid),
        amount: Number(customerForm.amount),
        method: customerForm.method,
        note: customerForm.note || null,
        fundingAccountCode: customerForm.fundingAccountCode?.trim() || undefined,
        ...(usingMfs
          ? { mfsPaymentId: mfsSession.paymentId, trxId: String(customerForm.mfsTrxId).trim() }
          : {}),
      });
      setCustomerForm({ ...customerForm, amount: "", note: "", fundingAccountCode: "", mfsTrxId: "" });
      setMfsSession(null);
      await load();
      if (cid) {
        const res = await api.get(`/dues/bakir-khata/${cid}`);
        setBakirKhata(res.data);
      }
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || "Collection failed");
    } finally {
      setSubmittingCustomer(false);
    }
  };

  const submitSupplierPayment = async (e) => {
    e.preventDefault();
    if (!requireSupplierCreate()) return;
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
    if (!requirePurchaseCreate()) return;
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
          <div className="page-title">{tt("duePageTitle")}</div>
          <div className="page-subtitle">{tt("duePageSubtitle")}</div>
        </div>
      </div>

      {fiscalBlocked ? (
        <div className="page-card fiscal-banner">
          <strong>Fiscal period — collections blocked</strong>
          <p>{fiscalGateData?.message || "No open fiscal period for today."}</p>
        </div>
      ) : null}

      {!canCollectCustomer ? <PermissionBanner show code="customer.create" tt={tt} /> : null}
      {!canPaySupplier ? <PermissionBanner show code="supplier.create" tt={tt} /> : null}
      {!canPayLoan ? <PermissionBanner show code="purchase.create" tt={tt} /> : null}

      {summary.purchaseBankLoans != null ? (
        <div className="page-card" style={{ marginTop: 8, padding: 12, background: "#f8fafc" }}>
          <strong>Purchase bank loans outstanding</strong>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {summary.purchaseBankLoans.count || 0} purchase(s) · Total {bdt(summary.purchaseBankLoans.totalOutstanding || 0)} (posts to Bank
            Loans Payable 2320 — not supplier payable)
          </p>
        </div>
      ) : null}

      {summary.customers.length ? (
        <div className="page-card" style={{ marginTop: 8, padding: 12, background: "#fffbeb" }}>
          <strong>{tt("dueBakiSmsTitle")}</strong>
          <p className="text-muted" style={{ margin: "6px 0 8px", fontSize: 13 }}>
            {tt("dueBakiSmsHelp", {
              count: summary.customers.length,
              total: bdt(summary.customers.reduce((sum, c) => sum + Number(c.balance || 0), 0)),
            })}
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={sendingReminders || !canCollectCustomer}
            onClick={async () => {
              if (!requireCustomerCreate()) return;
              if (!window.confirm(tt("dueBakiSmsConfirm", { count: summary.customers.length }))) return;
              setSendingReminders(true);
              try {
                const res = await api.post("/dues/customer-reminders", {});
                const s = res.data?.summary || {};
                const simulated = Number(s.simulated || 0) > 0;
                const parts = [
                  tt("dueBakiSmsResultSent", { n: s.sent || 0 }),
                  tt("dueBakiSmsResultSimulated", { n: s.simulated || 0 }),
                  tt("dueBakiSmsResultFailed", { n: s.failed || 0 }),
                ];
                if (res.data?.skippedNoPhone) {
                  parts.push(tt("dueBakiSmsSkipped", { n: res.data.skippedNoPhone }));
                }
                notifySuccess(
                  `${simulated ? tt("dueBakiSmsDoneSimulated") : tt("dueBakiSmsDone")}\n${parts.join(" · ")}`
                );
              } catch (err) {
                notifyError(err?.response?.data?.error || err?.message || tt("dueBakiSmsFailed"));
              } finally {
                setSendingReminders(false);
              }
            }}
          >
            {sendingReminders ? tt("dueBakiSmsSending") : tt("dueBakiSmsSend")}
          </button>
        </div>
      ) : null}

      <h4 style={{ marginTop: 8 }}>Collect customer due</h4>
      <form onSubmit={submitCustomerCollection} className="form-grid">
        <SearchSelect
          className="form-select-sm"
          value={customerForm.customerId}
          onChange={(val) => setCustomerForm({ ...customerForm, customerId: val })}
          placeholder="Select Customer"
          options={summary.customers.map((c) => ({
            value: String(c.id),
            label: `${c.name} (Due: ${bdt(c.balance || 0)})`,
          }))}
        />
        <input
          type="number"
          placeholder="Amount"
          value={customerForm.amount}
          onChange={(e) => setCustomerForm({ ...customerForm, amount: e.target.value })}
          required
        />
        <SearchSelect
          className="form-select-sm"
          value={customerForm.method}
          onChange={(val) => {
            setMfsSession(null);
            setCustomerForm({ ...customerForm, method: val || "Cash", mfsTrxId: "" });
          }}
          options={[
            { value: "Cash", label: "Cash" },
            { value: "Bank", label: "Bank" },
            { value: "bKash", label: "bKash" },
            { value: "Nagad", label: "Nagad" },
            { value: "Rocket", label: "Rocket" },
            { value: "Upay", label: "Upay" },
            { value: "Card", label: "Card" },
          ]}
          isClearable={false}
        />
        <input
          placeholder="GL code override (e.g. 1130 for bank)"
          value={customerForm.fundingAccountCode}
          onChange={(e) => setCustomerForm({ ...customerForm, fundingAccountCode: e.target.value })}
          title="Optional. Defaults: Cash → 1100, Bank → 1130, MFS → 1150"
        />
        <input
          placeholder="Note (optional)"
          value={customerForm.note}
          onChange={(e) => setCustomerForm({ ...customerForm, note: e.target.value })}
        />
        <SubmitButton loading={submittingCustomer} loadingLabel="Recording…" disabled={!canCollectCustomer || fiscalBlocked}>
          Collect due
        </SubmitButton>
      </form>

      {isMfsMethod(customerForm.method) ? (
        <div
          className="page-card"
          style={{ marginTop: 8, padding: 12, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8 }}
        >
          <strong>{customerForm.method} collection — verify payment</strong>
          {!mfsSession ? (
            <p className="text-muted" style={{ margin: "6px 0 8px", fontSize: 13 }}>
              Enter the amount above, then start the MFS payment. The customer pays to the merchant number / QR, then you enter the TrxID to verify.
            </p>
          ) : (
            <div style={{ margin: "6px 0 8px", fontSize: 13 }}>
              <div>
                Merchant: <strong>{mfsSession.merchantNumber || "—"}</strong> · Amount: <strong>{bdt(mfsSession.amount)}</strong>
              </div>
              {mfsSession.paymentUrl ? (
                <div>
                  Pay link:{" "}
                  <a href={mfsSession.paymentUrl} target="_blank" rel="noreferrer">
                    open
                  </a>
                </div>
              ) : null}
              <div className="text-muted">Session: {mfsSession.paymentId}</div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={initiatingMfs || !canCollectCustomer}
              onClick={initiateCustomerMfs}
            >
              {initiatingMfs ? "Starting…" : mfsSession ? "Restart MFS payment" : "Start MFS payment"}
            </button>
            <input
              placeholder="MFS TrxID"
              value={customerForm.mfsTrxId}
              onChange={(e) => setCustomerForm({ ...customerForm, mfsTrxId: e.target.value })}
              disabled={!mfsSession}
              style={{ maxWidth: 220 }}
            />
          </div>
        </div>
      ) : null}

      {customerForm.customerId ? (
        <div className="page-card" style={{ marginTop: 16 }}>
          <h4 style={{ marginTop: 0 }}>{tt("bakirKhataTitle")}</h4>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
            {tt("bakirKhataHelp")}
          </p>
          {loadingBakir ? (
            <p>{tt("bakirKhataLoading")}</p>
          ) : bakirKhata ? (
            <>
              <p>
                <strong>{tt("dashDue")}:</strong> {bdt(bakirKhata.currentBalance || 0)}
                {Number(bakirKhata.creditLimit || 0) > 0 ? (
                  <>
                    {" "}
                    · <strong>{tt("custCreditLimit")}:</strong> {bdt(bakirKhata.creditLimit)}
                  </>
                ) : null}
              </p>
              {(bakirKhata.entries || []).length ? (
                <DataTable
                  rows={[...(bakirKhata.entries || [])].reverse()}
                  rowKey="id"
                  columns={[
                    {
                      key: "createdAt",
                      label: tt("colDate"),
                      render: (v) => (v ? new Date(v).toLocaleString() : "—"),
                    },
                    { key: "entryType", label: tt("bakirEntryType"), render: (v) => bakirEntryLabel(v) },
                    {
                      key: "amount",
                      label: tt("colAmount"),
                      render: (v) => {
                        const n = Number(v || 0);
                        return `${n >= 0 ? "+" : ""}${bdt(n)}`;
                      },
                    },
                    { key: "balanceAfter", label: tt("bakirBalanceAfter"), render: (v) => bdt(v || 0) },
                    { key: "note", label: tt("colNote"), render: (v) => v || "—" },
                  ]}
                />
              ) : (
                <p className="text-muted">{tt("bakirKhataEmpty")}</p>
              )}
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={!canCollectCustomer || sendingBakirStatement}
                  onClick={async () => {
                    if (!requireCustomerCreate()) return;
                    setSendingBakirStatement(true);
                    try {
                      const res = await api.post(
                        `/dues/bakir-khata/${customerForm.customerId}/send-statement`,
                        { ledgerLines: 5 }
                      );
                      const simulated = String(res.data?.message || "").includes("simulated");
                      notifySuccess(simulated ? tt("bakirKhataSmsSimulated") : tt("bakirKhataSmsSent"));
                    } catch (err) {
                      notifyError(err?.response?.data?.error || err?.message || tt("bakirKhataSmsFailed"));
                    } finally {
                      setSendingBakirStatement(false);
                    }
                  }}
                >
                  {sendingBakirStatement ? tt("bakirKhataSmsSending") : tt("bakirKhataSmsSend")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <h4 style={{ marginTop: 20 }}>Repay purchase bank loan</h4>
      <p className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
        For purchases created with financing <strong>Bank loan</strong>: pay down principal from cash (1100) or bank (1130). Does not change
        supplier payable.
      </p>
      <form onSubmit={submitLoanPayment} className="form-grid">
        <SearchSelect
          className="form-select-sm"
          value={loanForm.purchaseId}
          onChange={(val) => setLoanForm({ ...loanForm, purchaseId: val })}
          placeholder={
            outstandingLoans.purchases?.length ? "Select purchase with loan balance" : "No outstanding purchase loans"
          }
          options={(outstandingLoans.purchases || []).map((p) => ({
            value: String(p.id),
            label: `#${p.id}${p.supplier?.name ? ` · ${p.supplier.name}` : ""} · Due ${bdt(p.dueAmount || 0)}${p.invoiceNo ? ` · ${p.invoiceNo}` : ""}`,
          }))}
        />
        <input
          type="number"
          placeholder="Amount"
          value={loanForm.amount}
          onChange={(e) => setLoanForm({ ...loanForm, amount: e.target.value })}
          required
        />
        <SearchSelect
          className="form-select-sm"
          value={loanForm.method}
          onChange={(val) => setLoanForm({ ...loanForm, method: val || "Cash" })}
          options={[
            { value: "Cash", label: "Cash (GL 1100)" },
            { value: "Bank", label: "Bank (GL 1130)" },
          ]}
          isClearable={false}
        />
        <input
          placeholder="GL code override (optional)"
          value={loanForm.fundingAccountCode}
          onChange={(e) => setLoanForm({ ...loanForm, fundingAccountCode: e.target.value })}
        />
        <input placeholder="Note (optional)" value={loanForm.note} onChange={(e) => setLoanForm({ ...loanForm, note: e.target.value })} />
        <SubmitButton loading={submittingLoan} loadingLabel="Posting…" disabled={!canPayLoan || fiscalBlocked}>
          Pay loan
        </SubmitButton>
      </form>

      <h4 style={{ marginTop: 16 }}>Pay Supplier Due (with AIT / VDS withholding)</h4>
      <form onSubmit={submitSupplierPayment} className="form-grid">
        <SearchSelect
          className="form-select-sm"
          value={supplierForm.supplierId}
          onChange={(val) => setSupplierForm({ ...supplierForm, supplierId: val })}
          placeholder="Select Supplier"
          options={summary.suppliers.map((s) => ({
            value: String(s.id),
            label: `${s.name} (Payable: ${bdt(s.payableBalance || 0)})${s.taxCategory ? ` · ${s.taxCategory}` : ""}${s.withholdingExempt ? " · EXEMPT" : ""}`,
          }))}
        />
        <input
          type="number"
          placeholder="Gross amount"
          value={supplierForm.amount}
          onChange={(e) => setSupplierForm({ ...supplierForm, amount: e.target.value })}
          required
        />
        <SearchSelect
          className="form-select-sm"
          value={supplierForm.method}
          onChange={(val) => setSupplierForm({ ...supplierForm, method: val || "Cash" })}
          options={[
            { value: "Cash", label: "Cash" },
            { value: "Bank", label: "Bank" },
            { value: "bKash", label: "bKash" },
            { value: "Nagad", label: "Nagad" },
            { value: "Card", label: "Card" },
          ]}
          isClearable={false}
        />
        <SearchSelect
          className="form-select-sm"
          value={supplierForm.taxCategoryOverride}
          onChange={(val) =>
            setSupplierForm({ ...supplierForm, taxCategoryOverride: val, aitRateOverride: "", vdsRateOverride: "" })
          }
          placeholder="Use supplier default"
          options={taxCategories.map((c) => ({ value: c.code, label: c.label }))}
          aria-label="Override the supplier's default tax category for this single payment"
        />
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
        <SubmitButton loading={submittingSupplier} loadingLabel="Posting payment…" disabled={!canPaySupplier || fiscalBlocked}>
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
