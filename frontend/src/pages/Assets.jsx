import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import useServerTable from "../hooks/useServerTable";
import { notifySuccess, notifyActionRequired, notifyPermissionRequired } from "../utils/notify";
import { getLang, t } from "../i18n";
import usePermissions from "../hooks/usePermissions";
import PermissionBanner from "../components/PermissionBanner";
import SearchSelect from "../components/SearchSelect";

const emptyForm = {
  assetCode: "",
  name: "",
  category: "",
  purchaseDate: "",
  inServiceDate: "",
  cost: "",
  salvageValue: "0",
  usefulLifeMonths: "60",
  notes: "",
};

export default function Assets() {
  const lang = getLang();
  const tt = useMemo(() => (key, params) => t(lang, key, params), [lang]);
  const { hasPermission } = usePermissions();
  const canManageAssets = hasPermission("asset.manage");

  const requireAssetManage = () => {
    if (canManageAssets) return true;
    notifyPermissionRequired(tt("permNeedCode", { code: "asset.manage" }));
    return false;
  };

  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("ACTIVE");
  const [form, setForm] = useState(emptyForm);
  const [asOfDate, setAsOfDate] = useState("");
  const [running, setRunning] = useState(false);

  const statusRef = useRef(status);
  statusRef.current = status;
  const fetchAssetsPage = useCallback(async (q) => {
    const res = await api.get("/assets", {
      params: {
        paged: true,
        ...(statusRef.current ? { status: statusRef.current } : {}),
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
  const assetsTable = useServerTable(fetchAssetsPage, { pageSize: 10, sortKey: "id", sortDir: "desc" });
  const rows = assetsTable.rows;

  const fetchEntries = useCallback(async () => {
    const entriesRes = await api.get("/assets/depreciation/entries");
    setEntries(Array.isArray(entriesRes.data) ? entriesRes.data : []);
  }, []);

  const load = useCallback(async () => {
    await Promise.all([assetsTable.refresh(), fetchEntries()]);
  }, [assetsTable, fetchEntries]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    assetsTable.setQuery((prev) => ({ ...prev, page: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const createAsset = async (e) => {
    e.preventDefault();
    if (!requireAssetManage()) return;
    if (!form.name.trim() || !form.purchaseDate || !form.inServiceDate) {
      notifyActionRequired("name, purchase date, and in-service date are required.");
      return;
    }
    await api.post("/assets", {
      ...form,
      name: form.name.trim(),
      assetCode: form.assetCode.trim() || undefined,
      category: form.category.trim() || undefined,
      cost: Number(form.cost),
      salvageValue: Number(form.salvageValue || 0),
      usefulLifeMonths: Number(form.usefulLifeMonths),
      notes: form.notes.trim() || undefined,
    });
    notifySuccess("asset registered.");
    setForm(emptyForm);
    load();
  };

  const runDepreciation = async () => {
    if (!requireAssetManage()) return;
    setRunning(true);
    try {
      const res = await api.post("/assets/depreciation/run", {
        asOfDate: asOfDate || undefined,
      });
      notifySuccess(`depreciation posted for ${Number(res.data?.postedCount || 0)} asset(s).`);
      setAsOfDate("");
      load();
    } finally {
      setRunning(false);
    }
  };

  const disposeAsset = async (id) => {
    if (!requireAssetManage()) return;
    const raw = window.prompt("Disposal proceeds amount (optional, default 0):", "0");
    if (raw == null) return;
    const disposalValue = Number(raw || 0);
    if (!Number.isFinite(disposalValue) || disposalValue < 0) {
      notifyActionRequired("enter a valid non-negative disposal amount.");
      return;
    }
    const res = await api.post(`/assets/${id}/dispose`, { disposalValue });
    const accounting = res.data?.disposalAccounting;
    if (accounting) {
      notifySuccess(
        `asset disposed. BV ${Number(accounting.bookValue || 0).toFixed(2)}, proceeds ${Number(
          accounting.proceeds || 0
        ).toFixed(2)}, gain ${Number(accounting.gain || 0).toFixed(2)}, loss ${Number(
          accounting.loss || 0
        ).toFixed(2)}.`
      );
    } else {
      notifySuccess("asset disposed.");
    }
    load();
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">Asset register &amp; depreciation</div>
          <div className="page-subtitle">Fixed assets and monthly straight-line depreciation postings</div>
        </div>
      </div>

      <PermissionBanner show={!canManageAssets} code="asset.manage" tt={tt} />

      <form onSubmit={createAsset} className="form-grid" style={{ marginBottom: 16 }}>
        <label>
          Asset code
          <input value={form.assetCode} onChange={(e) => setForm((p) => ({ ...p, assetCode: e.target.value }))} />
        </label>
        <label>
          Name
          <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </label>
        <label>
          Category
          <input value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} />
        </label>
        <label>
          Purchase date
          <input type="date" required value={form.purchaseDate} onChange={(e) => setForm((p) => ({ ...p, purchaseDate: e.target.value }))} />
        </label>
        <label>
          In-service date
          <input type="date" required value={form.inServiceDate} onChange={(e) => setForm((p) => ({ ...p, inServiceDate: e.target.value }))} />
        </label>
        <label>
          Cost
          <input type="number" step="0.01" required value={form.cost} onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))} />
        </label>
        <label>
          Salvage value
          <input type="number" step="0.01" value={form.salvageValue} onChange={(e) => setForm((p) => ({ ...p, salvageValue: e.target.value }))} />
        </label>
        <label>
          Useful life (months)
          <input type="number" min="1" required value={form.usefulLifeMonths} onChange={(e) => setForm((p) => ({ ...p, usefulLifeMonths: e.target.value }))} />
        </label>
        <label>
          Notes
          <input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit" disabled={!canManageAssets}>Add Asset</button>
        </div>
      </form>

      <div className="form-grid" style={{ marginBottom: 12 }}>
        <label>
          Status
          <SearchSelect
            className="form-select-sm"
            value={status}
            onChange={(val) => setStatus(val)}
            placeholder="All"
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "DISPOSED", label: "Disposed" },
            ]}
          />
        </label>
        <label>
          Depreciation as of
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="button" className="btn-secondary" onClick={runDepreciation} disabled={running || !canManageAssets}>
            {running ? "Running..." : "Run Depreciation"}
          </button>
        </div>
      </div>

      <h3>Assets</h3>
      <DataTable
        title="Assets"
        rows={rows}
        serverMode
        totalRows={assetsTable.total}
        loading={assetsTable.loading}
        onQueryChange={assetsTable.onQueryChange}
        initialSort="id"
        initialSortDir="desc"
        pageSize={10}
        columns={[
          { key: "assetCode", label: "Code", render: (v) => v || "-" },
          { key: "name", label: "Name" },
          { key: "status", label: "Status", searchable: false },
          { key: "cost", label: "Cost", searchable: false, render: (v) => Number(v || 0).toFixed(2) },
          {
            key: "accumulatedDepreciation",
            label: "Accum. Dep",
            searchable: false,
            render: (v) => Number(v || 0).toFixed(2),
          },
          {
            key: "bookValue",
            label: "Book Value",
            searchable: false,
            render: (_, r) => Math.max(0, Number(r.cost || 0) - Number(r.accumulatedDepreciation || 0)).toFixed(2),
          },
          {
            key: "disposal",
            label: "Disposal",
            searchable: false,
            render: (_, r) =>
              r.status === "DISPOSED"
                ? `${Number(r.disposalValue || 0).toFixed(2)} · ${r.disposedAt ? new Date(r.disposedAt).toLocaleDateString() : "-"}`
                : "-",
          },
          { key: "usefulLifeMonths", label: "Life (m)", searchable: false },
          {
            key: "lastDepreciationDate",
            label: "Last Dep",
            searchable: false,
            render: (v) => (v ? new Date(v).toLocaleDateString() : "-"),
          },
          {
            key: "actions",
            label: "Action",
            searchable: false,
            render: (_, r) =>
              r.status === "ACTIVE" ? (
                <button type="button" className="btn-secondary btn-sm" disabled={!canManageAssets} onClick={() => disposeAsset(r.id)}>
                  Dispose
                </button>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
        ]}
      />

      <h3 style={{ marginTop: 18 }}>Recent depreciation entries</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Period</th>
            <th>Asset</th>
            <th>Amount</th>
            <th>Journal</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, 100).map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.runDate).toLocaleDateString()}</td>
              <td>{e.periodKey}</td>
              <td>{e.asset?.assetCode ? `${e.asset.assetCode} - ${e.asset.name}` : e.asset?.name || e.assetId}</td>
              <td>{Number(e.amount || 0).toFixed(2)}</td>
              <td>{e.journalId || "-"}</td>
            </tr>
          ))}
          {!entries.length ? (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "#94a3b8" }}>
                No depreciation entries yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
