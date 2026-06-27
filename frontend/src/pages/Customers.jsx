import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import useServerTable from "../hooks/useServerTable";
import SubmitButton from "../components/SubmitButton";
import { getLang, t } from "../i18n";
import { BD_DISTRICTS, CUSTOMER_TYPES } from "../constants/bdDistricts";
import QrCodeImage from "../components/QrCodeImage";
import { buildLoyaltyCardUrl } from "../services/loyaltyPublic";
import { notifyError, notifyPermissionRequired, notifySuccess } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import SearchSelect from "../components/SearchSelect";

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
  const { hasPermission } = usePermissions();
  const canManageCustomers = hasPermission("customer.create");

  const requireCustomerCreate = () => {
    if (canManageCustomers) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "customer.create" }));
    return false;
  };

  const [form, setForm] = useState({
    name: "",
    phone: "",
    address: "",
    district: "",
    area: "",
    landmark: "",
    customerType: "RETAIL",
    buyerBin: "",
    companyName: "",
    whatsappOptIn: false,
    creditLimit: "0",
    birthDate: "",
    marketingOptIn: true,
    priceTier: "RETAIL",
    nidNumber: "",
    birthCertificateNo: "",
    kycDocumentType: "",
  });
  const [editingId, setEditingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [issuingLoyaltyCard, setIssuingLoyaltyCard] = useState(false);
  const [loyaltyCardUrl, setLoyaltyCardUrl] = useState("");

  const fetchCustomerPage = useCallback(async (q) => {
    const res = await api.get("/master/customers", {
      params: {
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
  const customersTable = useServerTable(fetchCustomerPage, {
    pageSize: 10,
    sortKey: "createdAt",
    sortDir: "desc",
  });
  const customers = customersTable.rows;
  const load = customersTable.refresh;

  const submit = async (e) => {
    e.preventDefault();
    if (!requireCustomerCreate()) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await api.put(`/master/customers/${editingId}`, form);
      } else {
        await api.post("/master/customers", form);
      }
      setForm({
        name: "",
        phone: "",
        address: "",
        district: "",
        area: "",
        landmark: "",
        customerType: "RETAIL",
        buyerBin: "",
        companyName: "",
        whatsappOptIn: false,
        creditLimit: "0",
        birthDate: "",
        marketingOptIn: true,
        priceTier: "RETAIL",
        nidNumber: "",
        birthCertificateNo: "",
        kycDocumentType: "",
      });
      setEditingId(null);
      setSelected(null);
      setLoyaltyCardUrl("");
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
      district: row.district || "",
      area: row.area || "",
      landmark: row.landmark || "",
      customerType: row.customerType || "RETAIL",
      buyerBin: row.buyerBin || "",
      companyName: row.companyName || "",
      whatsappOptIn: Boolean(row.whatsappOptIn),
      creditLimit: String(row.creditLimit ?? 0),
      birthDate: row.birthDate ? String(row.birthDate).slice(0, 10) : "",
      marketingOptIn: row.marketingOptIn == null ? true : Boolean(row.marketingOptIn),
      priceTier: row.priceTier || "RETAIL",
      nidNumber: row.nidNumber || "",
      birthCertificateNo: row.birthCertificateNo || "",
      kycDocumentType: row.kycDocumentType || "",
    });
  };

  const handleDetails = async (row) => {
    const res = await api.get(`/master/customers/${row.id}`);
    setSelected(res.data);
    setLoyaltyCardUrl(
      res.data?.loyaltyCardToken ? buildLoyaltyCardUrl(res.data.loyaltyCardToken) : ""
    );
  };

  const issueLoyaltyCard = async () => {
    if (!selected?.id || !requireCustomerCreate()) return;
    setIssuingLoyaltyCard(true);
    try {
      const res = await api.post(`/master/customers/${selected.id}/loyalty-card`);
      const url =
        res.data?.cardUrl ||
        (res.data?.loyaltyCardToken ? buildLoyaltyCardUrl(res.data.loyaltyCardToken) : "");
      setLoyaltyCardUrl(url);
      setSelected({ ...selected, loyaltyCardToken: res.data.loyaltyCardToken });
      notifySuccess(tt("custLoyaltyCardIssued"));
    } catch (e) {
      notifyError(e?.response?.data?.error || e?.message || tt("custLoyaltyCardFailed"));
    } finally {
      setIssuingLoyaltyCard(false);
    }
  };

  const printLoyaltyCard = async () => {
    if (!loyaltyCardUrl || !selected) return;
    try {
      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(loyaltyCardUrl, { width: 180, margin: 1 });
      const w = window.open("", "_blank", "width=420,height=560");
      if (!w) return;
      w.document.write(`
        <!DOCTYPE html><html><head><title>${selected.name || "Loyalty"}</title>
        <style>
          body { font-family: system-ui, sans-serif; text-align: center; padding: 24px; }
          h2 { margin: 0 0 8px; font-size: 18px; }
          p { margin: 4px 0 16px; color: #444; font-size: 13px; }
          img { width: 180px; height: 180px; }
        </style></head><body>
        <h2>${selected.name || ""}</h2>
        <p>${tt("custLoyaltyCardPrintHint")}</p>
        <img src="${dataUrl}" alt="QR" />
        <p style="font-size:11px;word-break:break-all">${loyaltyCardUrl}</p>
        <script>window.onload=function(){window.print();}</script>
        </body></html>`);
      w.document.close();
    } catch (e) {
      notifyError(tt("custLoyaltyCardFailed"));
    }
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
      <PermissionBanner show={!canManageCustomers} code="customer.create" tt={tt} />
      <form onSubmit={submit} className="form-grid">
        <input placeholder={tt("colName")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder={tt("colPhone")} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder={tt("colAddress")} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <SearchSelect
          value={form.district}
          onChange={(val) => setForm({ ...form, district: val })}
          placeholder={tt("custDistrict")}
          options={BD_DISTRICTS.map((d) => ({ value: d, label: d }))}
        />
        <input placeholder={tt("custArea")} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
        <input placeholder={tt("custLandmark")} value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} />
        <SearchSelect
          value={form.customerType}
          onChange={(val) => setForm({ ...form, customerType: val || "RETAIL" })}
          options={CUSTOMER_TYPES.map((ct) => ({ value: ct.value, label: tt(ct.labelKey) }))}
          isClearable={false}
        />
        <input placeholder={tt("custCompanyName")} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        <input placeholder={tt("custBuyerBin")} value={form.buyerBin} onChange={(e) => setForm({ ...form, buyerBin: e.target.value })} />
        <input
          placeholder={tt("custNidPh")}
          value={form.nidNumber}
          onChange={(e) => setForm({ ...form, nidNumber: e.target.value, kycDocumentType: e.target.value ? "NID" : form.kycDocumentType })}
        />
        <input
          placeholder={tt("custBirthCertPh")}
          value={form.birthCertificateNo}
          onChange={(e) =>
            setForm({
              ...form,
              birthCertificateNo: e.target.value,
              kycDocumentType: e.target.value ? "BIRTH_CERT" : form.kycDocumentType,
            })
          }
        />
        <SearchSelect
          className="form-select-sm"
          value={form.kycDocumentType}
          onChange={(val) => setForm({ ...form, kycDocumentType: val })}
          placeholder={tt("custKycDocType")}
          options={[
            { value: "NID", label: tt("custKycNid") },
            { value: "BIRTH_CERT", label: tt("custKycBirthCert") },
          ]}
        />
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
            checked={Boolean(form.whatsappOptIn)}
            onChange={(e) => setForm({ ...form, whatsappOptIn: e.target.checked })}
          />
          {tt("custWhatsappOptIn")}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={Boolean(form.marketingOptIn)}
            onChange={(e) => setForm({ ...form, marketingOptIn: e.target.checked })}
          />
          {tt("custMarketingOptIn")}
        </label>
        <SearchSelect
          className="form-select-sm"
          value={form.priceTier}
          onChange={(val) => setForm({ ...form, priceTier: val || "RETAIL" })}
          options={[
            { value: "RETAIL", label: tt("prodPriceTypeRetail") },
            { value: "WHOLESALE", label: tt("prodPriceTypeWholesale") },
            { value: "DEALER", label: tt("prodPriceTypeDealer") },
          ]}
          isClearable={false}
        />
        <SubmitButton loading={submitting} loadingLabel={editingId ? tt("settingsUpdating") : tt("settingsSaving")} disabled={!canManageCustomers}>
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
                <p>
                  <strong>{tt("custKycStatus")}:</strong>{" "}
                  {selected.nidNumber || selected.birthCertificateNo
                    ? `${selected.kycDocumentType || tt("custKycCaptured")} · ${selected.nidNumber || selected.birthCertificateNo}`
                    : tt("custKycMissing")}
                  {selected.kycCapturedAt ? (
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      {" "}
                      ({new Date(selected.kycCapturedAt).toLocaleDateString()})
                    </span>
                  ) : null}
                </p>
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
                {Number(selected.loyaltyExpiringSoonPoints || 0) > 0 ? (
                  <p><strong>{tt("custLoyaltyExpiringSoon")}:</strong> {Number(selected.loyaltyExpiringSoonPoints || 0).toFixed(0)}</p>
                ) : null}
                {Number(selected.loyaltyExpiredPoints || 0) > 0 ? (
                  <p><strong>{tt("custLoyaltyExpired")}:</strong> {Number(selected.loyaltyExpiredPoints || 0).toFixed(0)}</p>
                ) : null}
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
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border, #e5e7eb)" }}>
                  <h4 style={{ marginTop: 0 }}>{tt("custLoyaltyCardTitle")}</h4>
                  <p className="text-muted" style={{ fontSize: 13 }}>{tt("custLoyaltyCardHelp")}</p>
                  {loyaltyCardUrl ? (
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                      <QrCodeImage value={loyaltyCardUrl} size={160} alt={tt("custLoyaltyCardQrAlt")} />
                      <div style={{ fontSize: 12, maxWidth: 280 }}>
                        <code style={{ wordBreak: "break-all" }}>{loyaltyCardUrl}</code>
                        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" className="btn-secondary btn-sm" onClick={printLoyaltyCard}>
                            {tt("custLoyaltyCardPrint")}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={issuingLoyaltyCard || !canManageCustomers}
                            onClick={issueLoyaltyCard}
                          >
                            {issuingLoyaltyCard ? "…" : tt("custLoyaltyCardReissue")}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={issuingLoyaltyCard || !canManageCustomers || !selected.phone}
                      onClick={issueLoyaltyCard}
                    >
                      {issuingLoyaltyCard ? "…" : tt("custLoyaltyCardIssue")}
                    </button>
                  )}
                  {!selected.phone ? (
                    <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>{tt("custLoyaltyCardPhoneRequired")}</p>
                  ) : null}
                </div>
              </>
            );
          })()}
        </div>
      ) : null}
      <DataTable
        rows={customers}
        serverMode
        totalRows={customersTable.total}
        loading={customersTable.loading}
        onQueryChange={customersTable.onQueryChange}
        initialSort="createdAt"
        initialSortDir="desc"
        pageSize={10}
        columns={[
          { key: "id", label: tt("colId"), searchable: false },
          { key: "name", label: tt("colName") },
          { key: "phone", label: tt("colPhone"), render: (v) => v || "-" },
          { key: "address", label: tt("colAddress"), render: (v) => v || "-" },
          { key: "birthDate", label: tt("custBirthDate"), searchable: false, render: (v) => (v ? new Date(v).toLocaleDateString() : "-") },
          { key: "marketingOptIn", label: tt("custMarketing"), searchable: false, render: (v) => (v ? tt("custYes") : tt("custNo")) },
          { key: "priceTier", label: tt("custPriceTier"), render: (v) => v || "RETAIL" },
          { key: "balance", label: tt("dashDue"), searchable: false, render: (v) => `৳${Number(v).toFixed(2)}` },
          {
            key: "creditLimit",
            label: tt("custCreditCap"),
            searchable: false,
            render: (v) => (Number(v || 0) > 0 ? `৳${Number(v).toFixed(2)}` : tt("custInfinity")),
          },
          {
            key: "creditRemaining",
            label: tt("custAvailableCredit"),
            searchable: false,
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
            searchable: false,
            render: (_, row) => {
              const creditLimit = Number(row.creditLimit || 0);
              const balance = Number(row.balance || 0);
              if (creditLimit <= 0) return "-";
              return `${Math.min(100, (balance / creditLimit) * 100).toFixed(1)}%`;
            },
          },
          { key: "loyaltyPoints", label: tt("custPoints"), searchable: false, render: (v) => Number(v || 0).toFixed(0) },
          { key: "loyaltyTier", label: tt("custTier"), searchable: false, render: (v) => v || tt("custTierRegular") },
          {
            key: "actions",
            label: tt("colActions"),
            render: (_, row) => (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleDetails(row)}>{tt("supBtnDetails")}</button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => handleEdit(row)} disabled={!canManageCustomers}>{tt("actionEdit")}</button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default Customers;
