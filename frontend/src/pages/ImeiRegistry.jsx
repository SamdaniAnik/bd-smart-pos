import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import SubmitButton from "../components/SubmitButton";
import SearchSelect from "../components/SearchSelect";
import { notifyError, notifyPermissionRequired, notifySuccess } from "../utils/notify";
import { getLang, t } from "../i18n";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";

function ImeiRegistry() {
  const tt = useMemo(() => (key, params) => t(getLang(), key, params), []);
  const { hasPermission } = usePermissions();
  const canView = hasPermission("product.view");
  const canManage = hasPermission("inventory.adjust");

  const [products, setProducts] = useState([]);
  const [records, setRecords] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [intakeForm, setIntakeForm] = useState({ productId: "", imeis: "" });
  const [intaking, setIntaking] = useState(false);
  const [intakeResult, setIntakeResult] = useState(null);
  const [lookupValue, setLookupValue] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);

  const requireManage = () => {
    if (canManage) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "inventory.adjust" }));
    return false;
  };

  const loadProducts = async () => {
    try {
      const res = await api.get("/products", { params: { pageSize: 1000 } });
      const rows = Array.isArray(res.data) ? res.data : res.data?.data || res.data?.products || [];
      setProducts(rows.filter((p) => p.trackImei));
    } catch {
      setProducts([]);
    }
  };

  const loadRecords = async () => {
    try {
      const res = await api.get("/imei", {
        params: { status: statusFilter || undefined, search: search || undefined },
      });
      setRecords(res.data || []);
    } catch {
      setRecords([]);
    }
  };

  useEffect(() => {
    if (!canView) return;
    loadProducts();
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, statusFilter, search]);

  const submitIntake = async (e) => {
    e.preventDefault();
    if (!requireManage()) return;
    if (!intakeForm.imeis.trim()) {
      notifyError(tt("imeiEnterList"));
      return;
    }
    setIntaking(true);
    setIntakeResult(null);
    try {
      const res = await api.post("/imei/intake", {
        productId: intakeForm.productId ? Number(intakeForm.productId) : null,
        imeis: intakeForm.imeis,
      });
      setIntakeResult(res.data);
      notifySuccess(tt("imeiIntakeDone", { n: res.data?.created || 0 }));
      setIntakeForm({ ...intakeForm, imeis: "" });
      await loadRecords();
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || tt("imeiIntakeFailed"));
    } finally {
      setIntaking(false);
    }
  };

  const doLookup = async (e) => {
    e.preventDefault();
    const imei = lookupValue.replace(/[^0-9]/g, "");
    if (!imei) return;
    setLookingUp(true);
    setLookupResult(null);
    try {
      const res = await api.get("/imei/lookup", { params: { imei } });
      setLookupResult({ ok: true, ...res.data });
    } catch (err) {
      setLookupResult({ ok: false, error: err?.response?.data?.error || tt("imeiNotFound") });
    } finally {
      setLookingUp(false);
    }
  };

  const updateStatus = async (id, status) => {
    if (!requireManage()) return;
    try {
      await api.post(`/imei/${id}/status`, { status });
      notifySuccess(tt("imeiStatusUpdated"));
      await loadRecords();
    } catch (err) {
      notifyError(err?.response?.data?.error || err?.message || tt("imeiStatusFailed"));
    }
  };

  const statusLabel = (status) => {
    const key = {
      IN_STOCK: "imeiStatusInStock",
      SOLD: "imeiStatusSold",
      RETURNED: "imeiStatusReturned",
      BLOCKED: "imeiStatusBlocked",
    }[status];
    return key ? tt(key) : status;
  };

  if (!canView) {
    return (
      <div className="page-stack">
        <PermissionBanner show code="product.view" tt={tt} />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("imeiPageTitle")}</div>
          <div className="page-subtitle">{tt("imeiPageSubtitle")}</div>
        </div>
      </div>

      {!canManage ? <PermissionBanner show code="inventory.adjust" tt={tt} /> : null}

      <div className="page-card">
        <h4 style={{ marginTop: 0 }}>{tt("imeiLookupTitle")}</h4>
        <form onSubmit={doLookup} className="form-grid">
          <input
            placeholder={tt("imeiLookupPh")}
            value={lookupValue}
            onChange={(e) => setLookupValue(e.target.value)}
          />
          <SubmitButton loading={lookingUp} loadingLabel={tt("imeiLooking")}>
            {tt("imeiLookupBtn")}
          </SubmitButton>
        </form>
        {lookupResult ? (
          lookupResult.ok ? (
            <div className="page-card" style={{ marginTop: 8, padding: 12, background: "#f1f5f9" }}>
              <div>
                <strong>IMEI:</strong> {lookupResult.imei}
              </div>
              {lookupResult.record ? (
                <div>
                  {tt("imeiColStatus")}: <strong>{statusLabel(lookupResult.record.status)}</strong>
                </div>
              ) : null}
              {lookupResult.saleItem ? (
                <div style={{ marginTop: 4 }}>
                  {tt("imeiSoldOn")}:{" "}
                  {lookupResult.saleItem.sale?.invoiceNo || `#${lookupResult.saleItem.sale?.id}`} ·{" "}
                  {lookupResult.saleItem.sale?.createdAt
                    ? new Date(lookupResult.saleItem.sale.createdAt).toLocaleString()
                    : ""}
                  {lookupResult.saleItem.sale?.customer?.name
                    ? ` · ${lookupResult.saleItem.sale.customer.name}`
                    : ""}
                  {lookupResult.saleItem.product?.name ? ` · ${lookupResult.saleItem.product.name}` : ""}
                </div>
              ) : null}
            </div>
          ) : (
            <p style={{ color: "#b42318", marginTop: 8 }}>{lookupResult.error}</p>
          )
        ) : null}
      </div>

      <div className="page-card">
        <h4 style={{ marginTop: 0 }}>{tt("imeiIntakeTitle")}</h4>
        <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
          {tt("imeiIntakeHelp")}
        </p>
        <form onSubmit={submitIntake} className="form-grid">
          <SearchSelect
            className="form-select-sm"
            value={intakeForm.productId}
            onChange={(val) => setIntakeForm({ ...intakeForm, productId: val })}
            placeholder={tt("imeiSelectProduct")}
            options={products.map((p) => ({ value: String(p.id), label: `${p.name}${p.sku ? ` · ${p.sku}` : ""}` }))}
          />
          <textarea
            placeholder={tt("imeiListPh")}
            value={intakeForm.imeis}
            onChange={(e) => setIntakeForm({ ...intakeForm, imeis: e.target.value })}
            rows={4}
            style={{ gridColumn: "1 / -1" }}
          />
          <SubmitButton loading={intaking} loadingLabel={tt("imeiIntaking")} disabled={!canManage}>
            {tt("imeiIntakeBtn")}
          </SubmitButton>
        </form>
        {intakeResult ? (
          <div className="page-card" style={{ marginTop: 8, padding: 12, background: "#ecfdf5" }}>
            <div>
              <strong>{tt("imeiAccepted")}:</strong> {intakeResult.created} / {intakeResult.acceptedCount}
            </div>
            {intakeResult.rejected?.length ? (
              <div style={{ marginTop: 6 }}>
                <strong>{tt("imeiRejected")} ({intakeResult.rejected.length}):</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
                  {intakeResult.rejected.slice(0, 30).map((r) => (
                    <li key={r.imei}>
                      {r.imei} — {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="page-card">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <SearchSelect
            className="form-select-sm"
            value={statusFilter}
            onChange={(val) => setStatusFilter(val || "")}
            placeholder={tt("imeiFilterStatus")}
            options={[
              { value: "IN_STOCK", label: tt("imeiStatusInStock") },
              { value: "SOLD", label: tt("imeiStatusSold") },
              { value: "RETURNED", label: tt("imeiStatusReturned") },
              { value: "BLOCKED", label: tt("imeiStatusBlocked") },
            ]}
          />
          <input
            placeholder={tt("imeiSearchPh")}
            value={search}
            onChange={(e) => setSearch(e.target.value.replace(/[^0-9]/g, ""))}
            style={{ maxWidth: 240 }}
          />
        </div>
        <DataTable
          title={tt("imeiListTitle")}
          rows={records.map((r) => ({
            ...r,
            productName: r.product?.name || "—",
            statusLabel: statusLabel(r.status),
            updatedLabel: r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "",
          }))}
          rowKey="id"
          searchableKeys={["imei", "productName", "statusLabel"]}
          columns={[
            { key: "imei", label: "IMEI" },
            { key: "productName", label: tt("imeiColProduct") },
            { key: "statusLabel", label: tt("imeiColStatus") },
            { key: "updatedLabel", label: tt("imeiColUpdated") },
            {
              key: "actions",
              label: "",
              searchable: false,
              render: (_v, row) => (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {row.status !== "BLOCKED" ? (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => updateStatus(row.id, "BLOCKED")}>
                      {tt("imeiBlock")}
                    </button>
                  ) : null}
                  {row.status !== "IN_STOCK" ? (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => updateStatus(row.id, "IN_STOCK")}>
                      {tt("imeiRestock")}
                    </button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

export default ImeiRegistry;
