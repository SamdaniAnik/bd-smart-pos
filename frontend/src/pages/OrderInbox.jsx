import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import DataTable from "../components/DataTable";
import useServerTable from "../hooks/useServerTable";
import SubmitButton from "../components/SubmitButton";
import usePermissions from "../hooks/usePermissions";
import SearchSelect from "../components/SearchSelect";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import { getLang, t } from "../i18n";
import { BD_DISTRICTS, COURIER_OPTIONS, ORDER_SOURCES } from "../constants/bdDistricts";

function OrderInbox() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("sale.create");

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

  const [shipments, setShipments] = useState([]);
  const [syncingAll, setSyncingAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    source: "PHONE",
    customerName: "",
    customerPhone: "",
    district: "",
    area: "",
    landmark: "",
    deliveryAddress: "",
    deliveryFee: "60",
    courierName: "",
    trackingId: "",
    paymentMethod: "Cash",
    notes: "",
    productId: "",
    qty: "1",
  });

  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const fetchOrdersPage = useCallback(async (q) => {
    const res = await api.get("/orders", {
      params: {
        paged: true,
        ...(statusFilterRef.current ? { status: statusFilterRef.current } : {}),
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
  const ordersTable = useServerTable(fetchOrdersPage, {
    pageSize: 10,
    sortKey: "createdAt",
    sortDir: "desc",
  });
  const rows = ordersTable.rows;

  const fetchShipments = useCallback(async () => {
    const shipRes = await api.get("/courier/shipments").catch(() => ({ data: [] }));
    setShipments(Array.isArray(shipRes.data) ? shipRes.data : []);
  }, []);

  const load = useCallback(async () => {
    await Promise.all([ordersTable.refresh(), fetchShipments()]);
  }, [ordersTable, fetchShipments]);

  const syncShipment = async (row) => {
    try {
      const res = await api.post(`/courier/shipments/${row.id}/sync`);
      notifySuccess(res.data?.synced ? `Status: ${res.data.shipment?.status}` : res.data?.reason || "Not updated");
      await load();
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || "Sync failed");
    }
  };

  const syncAllShipments = async () => {
    setSyncingAll(true);
    try {
      const res = await api.post("/courier/shipments/sync-all");
      notifySuccess(`Synced ${res.data?.synced || 0}/${res.data?.scanned || 0} (delivered ${res.data?.delivered || 0})`);
      await load();
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || "Sync failed");
    } finally {
      setSyncingAll(false);
    }
  };

  const collectCod = async (row) => {
    if (!window.confirm(`Mark COD ৳${Number(row.codAmount || 0).toFixed(0)} as collected?`)) return;
    try {
      await api.post(`/courier/shipments/${row.id}/collect-cod`);
      notifySuccess("COD collected and journal posted");
      await load();
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || "Collect COD failed");
    }
  };

  const printLabel = async (row) => {
    try {
      const res = await api.get(`/courier/shipments/${row.id}/label`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || "Label print failed");
    }
  };

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    ordersTable.setQuery((prev) => ({ ...prev, page: 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const districtOptions = useMemo(
    () => BD_DISTRICTS.map((d) => ({ value: d, label: d })),
    []
  );

  const submitOrder = async (e) => {
    e.preventDefault();
    if (!canCreate) {
      notifyActionRequired(tt("orderNeedCreatePerm"));
      return;
    }
    const customerName = String(form.customerName || "").trim();
    if (customerName.length < 2) {
      notifyActionRequired(tt("orderCustomerRequired"));
      return;
    }
    const productId = Number(form.productId);
    const qty = Number(form.qty || 0);
    if (!productId || qty <= 0) {
      notifyActionRequired(tt("orderLineRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/orders", {
        source: form.source,
        customerName,
        customerPhone: form.customerPhone?.trim() || null,
        district: form.district || null,
        area: form.area?.trim() || null,
        landmark: form.landmark?.trim() || null,
        deliveryAddress: form.deliveryAddress?.trim() || null,
        deliveryFee: Number(form.deliveryFee || 0),
        courierName: form.courierName?.trim() || null,
        trackingId: form.trackingId?.trim() || null,
        paymentMethod: form.paymentMethod || "Cash",
        notes: form.notes?.trim() || null,
        lines: [{ productId, qty }],
      });
      setForm((prev) => ({
        ...prev,
        customerName: "",
        customerPhone: "",
        area: "",
        landmark: "",
        deliveryAddress: "",
        notes: "",
        productId: "",
        qty: "1",
      }));
      await load();
      notifySuccess(tt("orderCreated"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("orderCreateFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const createShipment = async (row) => {
    if (!canCreate) return;
    try {
      const res = await api.post("/courier/shipments", { pendingOrderId: row.id });
      notifySuccess(tt("orderShipmentCreated", { tracking: res.data?.trackingId || "—" }));
      await load();
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("orderShipmentFailed"));
    }
  };

  const cancelOrder = async (row) => {
    if (!canCreate) return;
    if (!window.confirm(tt("orderCancelConfirm", { no: row.orderNo || row.id }))) return;
    await api.post(`/orders/${row.id}/cancel`);
    await load();
    notifySuccess(tt("orderCancelled"));
  };

  const loadAtPos = (row) => {
    if (!canCreate) {
      notifyActionRequired(tt("orderNeedCreatePerm"));
      return;
    }
    localStorage.setItem("bd_pos_load_pending_order_id", String(row.id));
    window.location.hash = "pos";
    window.dispatchEvent(new CustomEvent("bd_pos_load_pending_order"));
  };

  const statusLabel = (status) => {
    const key = `orderStatus${String(status || "").charAt(0)}${String(status || "")
      .slice(1)
      .toLowerCase()}`;
    return tt(key);
  };

  return (
    <div>
      <h2>{tt("orderInboxTitle")}</h2>
      <p className="text-muted">{tt("orderInboxHelp")}</p>

      <div className="page-card" style={{ marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>{tt("orderCreateTitle")}</h4>
        <form onSubmit={submitOrder} className="form-grid">
          <SearchSelect
            value={form.source}
            onChange={(val) => setForm({ ...form, source: val || "PHONE" })}
            options={ORDER_SOURCES.map((s) => ({ value: s.value, label: tt(s.labelKey) }))}
            isClearable={false}
          />
          <input
            placeholder={tt("orderPhCustomerName")}
            value={form.customerName}
            onChange={(e) => setForm({ ...form, customerName: e.target.value })}
            required
          />
          <input
            placeholder={tt("orderPhPhone")}
            value={form.customerPhone}
            onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
          />
          <SearchSelect
            value={form.district}
            onChange={(val) => setForm({ ...form, district: val })}
            placeholder={tt("orderPhDistrict")}
            options={districtOptions}
          />
          <input
            placeholder={tt("orderPhArea")}
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
          />
          <input
            placeholder={tt("orderPhLandmark")}
            value={form.landmark}
            onChange={(e) => setForm({ ...form, landmark: e.target.value })}
          />
          <input
            placeholder={tt("orderPhAddress")}
            value={form.deliveryAddress}
            onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
          />
          <input
            type="number"
            min="0"
            step="1"
            placeholder={tt("orderPhDeliveryFee")}
            value={form.deliveryFee}
            onChange={(e) => setForm({ ...form, deliveryFee: e.target.value })}
          />
          <SearchSelect
            value={form.courierName}
            onChange={(val) => setForm({ ...form, courierName: val })}
            placeholder={tt("orderPhCourier")}
            options={COURIER_OPTIONS.map((c) => ({ value: c, label: c }))}
          />
          <SearchSelect
            kind="products"
            value={form.productId}
            onChange={(val) => setForm({ ...form, productId: val })}
            placeholder={tt("orderPhProduct")}
          />
          <input
            type="number"
            min="1"
            placeholder={tt("orderPhQty")}
            value={form.qty}
            onChange={(e) => setForm({ ...form, qty: e.target.value })}
          />
          <SearchSelect
            value={form.paymentMethod}
            onChange={(val) => setForm({ ...form, paymentMethod: val || "Cash" })}
            options={[
              { value: "Cash", label: t(uiLang, "dashMethodCash") },
              { value: "bKash", label: t(uiLang, "dashMethodBkash") },
              { value: "Nagad", label: t(uiLang, "dashMethodNagad") },
              { value: "Due", label: t(uiLang, "posPayDueCredit") },
              { value: "COD", label: t(uiLang, "dashMethodCod") },
            ]}
            isClearable={false}
          />
          <input
            placeholder={tt("orderPhNotes")}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <SubmitButton type="submit" loading={submitting} disabled={!canCreate}>
            {tt("orderSubmit")}
          </SubmitButton>
        </form>
      </div>

      <div className="page-card">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <strong>{tt("orderListTitle")}</strong>
          <SearchSelect
            value={statusFilter}
            onChange={(val) => setStatusFilter(val || "")}
            placeholder={tt("orderStatusAll")}
            options={[
              { value: "PENDING", label: tt("orderStatusPending") },
              { value: "LOADED", label: tt("orderStatusLoaded") },
              { value: "COMPLETED", label: tt("orderStatusCompleted") },
              { value: "CANCELLED", label: tt("orderStatusCancelled") },
            ]}
          />
          <button type="button" className="btn-secondary btn-sm" onClick={load}>
            {tt("settingsRefreshReadiness")}
          </button>
        </div>
        <DataTable
          rows={rows}
          serverMode
          totalRows={ordersTable.total}
          loading={ordersTable.loading}
          onQueryChange={ordersTable.onQueryChange}
          initialSort="createdAt"
          initialSortDir="desc"
          pageSize={10}
          columns={[
            { key: "orderNo", label: tt("orderColNo"), render: (v, row) => v || `#${row.id}` },
            {
              key: "source",
              label: tt("orderColSource"),
              searchable: false,
              render: (v) => ORDER_SOURCES.find((s) => s.value === v)?.labelKey ? tt(ORDER_SOURCES.find((s) => s.value === v).labelKey) : v,
            },
            { key: "customerName", label: tt("colName") },
            { key: "customerPhone", label: tt("colPhone"), render: (v) => v || "—" },
            { key: "district", label: tt("custDistrict"), render: (v) => v || "—" },
            { key: "lineCount", label: tt("orderColLines"), searchable: false, render: (v) => v ?? "—" },
            {
              key: "deliveryFee",
              label: tt("orderColFee"),
              searchable: false,
              render: (v) => (Number(v || 0) > 0 ? `৳${Number(v).toFixed(0)}` : "—"),
            },
            {
              key: "status",
              label: tt("colStatus"),
              searchable: false,
              render: (v) => statusLabel(v),
            },
            {
              key: "trackingId",
              label: tt("orderColTracking"),
              render: (v) => v || "—",
            },
            {
              key: "createdAt",
              label: tt("colDate"),
              searchable: false,
              render: (v) => (v ? new Date(v).toLocaleString() : "—"),
            },
            {
              key: "id",
              label: tt("colActions"),
              searchable: false,
              render: (_, row) => (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {row.status === "PENDING" || row.status === "LOADED" ? (
                    <button type="button" className="btn-primary btn-sm" onClick={() => loadAtPos(row)}>
                      {tt("orderLoadPos")}
                    </button>
                  ) : null}
                  {row.status === "PENDING" || row.status === "LOADED" ? (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => createShipment(row)}>
                      {tt("orderCreateShipment")}
                    </button>
                  ) : null}
                  {row.status === "PENDING" || row.status === "LOADED" ? (
                    <button type="button" className="btn-danger btn-sm" onClick={() => cancelOrder(row)}>
                      {tt("orderCancel")}
                    </button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </div>

      <div className="page-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <strong>Courier shipments</strong>
          <button type="button" className="btn-secondary btn-sm" disabled={syncingAll} onClick={syncAllShipments}>
            {syncingAll ? "Syncing…" : "Sync all statuses"}
          </button>
        </div>
        <DataTable
          rows={shipments}
          columns={[
            { key: "id", label: "#" },
            { key: "provider", label: "Courier", render: (v) => String(v || "").toUpperCase() },
            { key: "trackingId", label: tt("orderColTracking"), render: (v) => v || "—" },
            { key: "recipientName", label: tt("colName"), render: (v) => v || "—" },
            { key: "status", label: tt("colStatus") },
            {
              key: "codAmount",
              label: "COD",
              render: (v) => (Number(v || 0) > 0 ? `৳${Number(v).toFixed(0)}` : "—"),
            },
            {
              key: "lastSyncedAt",
              label: "Last sync",
              render: (v) => (v ? new Date(v).toLocaleString() : "—"),
            },
            {
              key: "actions",
              label: tt("colActions"),
              render: (_, row) => (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => syncShipment(row)}>
                    Sync
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => printLabel(row)}>
                    Label
                  </button>
                  {Number(row.codAmount || 0) > 0 && !row.codCollectedAt ? (
                    <button type="button" className="btn-primary btn-sm" onClick={() => collectCod(row)}>
                      Collect COD
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

export default OrderInbox;
