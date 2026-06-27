import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import useServerTable from "../hooks/useServerTable";
import { getLang, t } from "../i18n";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import SearchSelect from "../components/SearchSelect";

const STATUSES = ["OPEN", "APPROVED", "REJECTED", "COMPLETED", "REPLACED"];

function WarrantyClaims() {
  const lang = getLang();
  const tt = useMemo(() => (key, params) => t(lang, key, params), [lang]);
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("customer.create");

  const [form, setForm] = useState({ serialNumber: "", issue: "" });
  const [busy, setBusy] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");

  const filterStatusRef = useRef(filterStatus);
  filterStatusRef.current = filterStatus;
  const fetchClaimsPage = useCallback(async (q) => {
    const res = await api.get("/warranty/claims", {
      params: {
        paged: true,
        ...(filterStatusRef.current ? { status: filterStatusRef.current } : {}),
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
  const claimsTable = useServerTable(fetchClaimsPage, {
    pageSize: 10,
    sortKey: "createdAt",
    sortDir: "desc",
  });
  const claims = claimsTable.rows;
  const load = claimsTable.refresh;

  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    claimsTable.setQuery((prev) => ({ ...prev, page: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  const submitClaim = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      await api.post("/warranty/claims", form);
      setForm({ serialNumber: "", issue: "" });
      notifySuccess(tt("warrantyClaimCreated"));
      await load();
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || err?.message || tt("warrantyClaimFailed"));
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (row, status) => {
    if (!canManage) return;
    const resolution =
      status === "REJECTED" || status === "COMPLETED"
        ? window.prompt(tt("warrantyResolutionPh"), row.resolution || "") || ""
        : "";
    try {
      await api.patch(`/warranty/claims/${row.id}/status`, { status, resolution });
      notifySuccess(tt("warrantyStatusUpdated"));
      await load();
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || err?.message);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("warrantyTitle")}</div>
          <div className="page-subtitle">{tt("warrantySubtitle")}</div>
        </div>
      </div>
      {!canManage ? <PermissionBanner show code="customer.create" tt={tt} /> : null}

      <div className="page-card">
        <h4 style={{ marginTop: 0 }}>{tt("warrantyNewClaim")}</h4>
        <form className="form-grid" style={{ maxWidth: 520 }} onSubmit={submitClaim}>
          <input
            required
            placeholder={tt("warrantySerialPh")}
            value={form.serialNumber}
            onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
          />
          <textarea
            required
            rows={3}
            placeholder={tt("warrantyIssuePh")}
            value={form.issue}
            onChange={(e) => setForm({ ...form, issue: e.target.value })}
          />
          <button type="submit" className="btn-primary btn-sm" disabled={busy || !canManage}>
            {busy ? "…" : tt("warrantySubmit")}
          </button>
        </form>
      </div>

      <div className="page-card">
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <SearchSelect
            className="form-select-sm"
            value={filterStatus}
            onChange={(val) => setFilterStatus(val)}
            placeholder={tt("warrantyAllStatus")}
            options={STATUSES.map((s) => ({ value: s, label: s }))}
          />
        </div>
        <DataTable
          serverMode
          totalRows={claimsTable.total}
          loading={claimsTable.loading}
          onQueryChange={claimsTable.onQueryChange}
          initialSort="createdAt"
          initialSortDir="desc"
          pageSize={10}
          columns={[
            { key: "claimNo", label: tt("warrantyClaimNo") },
            { key: "serialNumber", label: tt("warrantySerial") },
            { key: "invoiceNo", label: tt("receiptInvoice") },
            { key: "status", label: tt("warrantyStatus"), searchable: false },
            {
              key: "warrantyUntil",
              label: tt("warrantyUntil"),
              searchable: false,
              render: (v) => (v ? new Date(v).toLocaleDateString() : "—"),
            },
            { key: "issue", label: tt("warrantyIssue"), render: (v) => String(v || "").slice(0, 60) },
            {
              key: "actions",
              label: "",
              render: (_, row) =>
                row.status === "OPEN" && canManage ? (
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => updateStatus(row, "APPROVED")}>
                      {tt("warrantyApprove")}
                    </button>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => updateStatus(row, "REJECTED")}>
                      {tt("warrantyReject")}
                    </button>
                    <button type="button" className="btn-primary btn-sm" onClick={() => updateStatus(row, "COMPLETED")}>
                      {tt("warrantyComplete")}
                    </button>
                  </span>
                ) : null,
            },
          ]}
          rows={claims}
          rowKey="id"
        />
      </div>
    </div>
  );
}

export default WarrantyClaims;
