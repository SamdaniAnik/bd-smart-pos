import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import QrCodeImage from "../components/QrCodeImage";
import { buildStorefrontUrl } from "../services/storefront";
import { getLang, t } from "../i18n";
import { notifyActionRequired, notifySuccess } from "../utils/notify";
import usePermissions from "../hooks/usePermissions";
import { printEscPosLines } from "../utils/printBridge";
import { formatBDT } from "../utils/currency";
import SearchSelect from "../components/SearchSelect";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function Restaurant() {
  const lang = getLang();
  const tt = useMemo(() => (key, params) => t(lang, key, params), [lang]);
  const { hasPermission } = usePermissions();
  const canOperate = hasPermission("sale.create");
  const canSeed = hasPermission("sale.create");

  const [tab, setTab] = useState("summary");
  const [summaryDate, setSummaryDate] = useState(todayIsoDate());
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [tables, setTables] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [kotLines, setKotLines] = useState([{ productId: "", qty: 1, notes: "" }]);
  const [busy, setBusy] = useState(false);
  const [storefrontToken, setStorefrontToken] = useState("");

  const load = async () => {
    const [tRes, kRes, pRes] = await Promise.all([
      api.get("/restaurant/tables"),
      api.get("/restaurant/kot"),
      api.get("/products"),
    ]);
    setTables(Array.isArray(tRes.data) ? tRes.data : []);
    setTickets(Array.isArray(kRes.data) ? kRes.data : []);
    setProducts(Array.isArray(pRes.data) ? pRes.data : []);
  };

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const res = await api.get("/restaurant/summary", { params: { from: summaryDate, to: summaryDate } });
      setSummary(res.data || null);
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("restSummaryFailed"));
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    load();
    api
      .get("/restaurant/storefront-token")
      .then((res) => setStorefrontToken(res.data?.storefrontToken || ""))
      .catch(() => setStorefrontToken(""));
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (tab === "summary") loadSummary();
  }, [tab, summaryDate]);

  const seedTables = async () => {
    if (!canSeed) return;
    setBusy(true);
    try {
      await api.post("/restaurant/tables/seed", { count: 10 });
      await load();
      notifySuccess(tt("restSeedOk"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("restSeedFailed"));
    } finally {
      setBusy(false);
    }
  };

  const sendKot = async () => {
    if (!canOperate) return;
    const items = kotLines
      .map((line) => {
        const product = products.find((p) => String(p.id) === String(line.productId));
        if (!product) return null;
        return {
          productId: product.id,
          name: product.name,
          qty: Number(line.qty || 1),
          notes: line.notes?.trim() || "",
        };
      })
      .filter(Boolean);
    if (!items.length) {
      notifyActionRequired(tt("restKotItemsRequired"));
      return;
    }
    setBusy(true);
    try {
      await api.post("/restaurant/kot", { tableId: selectedTable?.id || null, items });
      setKotLines([{ productId: "", qty: 1, notes: "" }]);
      await load();
      notifySuccess(tt("restKotSent"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("restKotFailed"));
    } finally {
      setBusy(false);
    }
  };

  const updateKotStatus = async (id, status) => {
    if (!canOperate) return;
    try {
      await api.patch(`/restaurant/kot/${id}/status`, { status });
      await load();
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("restKotStatusFailed"));
    }
  };

  const printKot = async (id) => {
    try {
      const res = await api.get(`/restaurant/kot/${id}/print-lines`);
      await printEscPosLines(res.data?.lines || []);
      notifySuccess(tt("restKotPrintOk"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("restKotPrintFailed"));
    }
  };

  const tableStatusClass = (status) => {
    if (status === "OCCUPIED") return "rest-table-occupied";
    if (status === "BILLING") return "rest-table-billing";
    return "rest-table-free";
  };

  const tableStatusLabel = (status) => {
    const key =
      status === "OCCUPIED"
        ? "restTableStatusOccupied"
        : status === "BILLING"
          ? "restTableStatusBilling"
          : "restTableStatusFree";
    return tt(key);
  };

  const tableCounts = useMemo(() => {
    const counts = { FREE: 0, OCCUPIED: 0, BILLING: 0 };
    for (const table of tables) {
      const st = String(table.status || "FREE").toUpperCase();
      if (counts[st] != null) counts[st] += 1;
    }
    return counts;
  }, [tables]);

  const refreshSelectedTable = (allTables, id) => {
    const row = allTables.find((t) => t.id === id);
    if (row) setSelectedTable(row);
  };

  const runTableAction = async (action) => {
    if (!selectedTable || !canOperate) return;
    setBusy(true);
    try {
      const id = selectedTable.id;
      let res;
      if (action === "seat") res = await api.post(`/restaurant/tables/${id}/seat`);
      else if (action === "bill") res = await api.post(`/restaurant/tables/${id}/request-bill`);
      else if (action === "collected") res = await api.post(`/restaurant/tables/${id}/bill-collected`);
      else if (action === "free") res = await api.post(`/restaurant/tables/${id}/clear`);
      const tRes = await api.get("/restaurant/tables");
      const nextTables = Array.isArray(tRes.data) ? tRes.data : [];
      setTables(nextTables);
      refreshSelectedTable(nextTables, res?.data?.id || id);
      if (action === "seat") notifySuccess(tt("restTableOccupiedOk"));
      else if (action === "bill") notifySuccess(tt("restTableBillingOk"));
      else if (action === "collected") notifySuccess(tt("restBillCollectedOk"));
      else if (action === "free") notifySuccess(tt("restTableFreeOk"));
    } catch (err) {
      notifyActionRequired(err?.response?.data?.error || tt("restTableActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const copyTableOrderLink = async (table) => {
    if (!storefrontToken || !table?.code) return;
    try {
      await navigator.clipboard.writeText(buildStorefrontUrl(storefrontToken, { table: table.code }));
      notifySuccess(tt("restTableLinkCopied"));
    } catch {
      notifyActionRequired(tt("settingsClipboardUnavailable"));
    }
  };

  const selectTable = async (table) => {
    setSelectedTable(table);
    if (table.status === "FREE" && canOperate) {
      try {
        const res = await api.post(`/restaurant/tables/${table.id}/seat`);
        setSelectedTable(res.data);
        const tRes = await api.get("/restaurant/tables");
        setTables(Array.isArray(tRes.data) ? tRes.data : []);
      } catch {
        /* keep selection even if seat fails */
      }
    }
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <div>
          <div className="page-title">{tt("restTitle")}</div>
          <div className="page-subtitle">{tt("restSubtitle")}</div>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => (tab === "summary" ? loadSummary() : load())}>
          {tt("settingsRefreshReadiness")}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { key: "summary", label: tt("restTabSummary") },
          { key: "floor", label: tt("restTabFloor") },
          { key: "kitchen", label: tt("restTabKitchen") },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`btn-secondary btn-sm${tab === key ? " btn-primary" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" ? (
        <>
          <div className="page-card">
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <label style={{ fontSize: 13 }}>
                {tt("restSummaryDate")}{" "}
                <input type="date" value={summaryDate} onChange={(e) => setSummaryDate(e.target.value)} />
              </label>
              <button type="button" className="btn-secondary btn-sm" onClick={loadSummary} disabled={summaryLoading}>
                {summaryLoading ? tt("settingsLoading") : tt("settingsRefreshReadiness")}
              </button>
            </div>
            {summaryLoading && !summary ? (
              <p className="text-muted">{tt("settingsLoading")}</p>
            ) : summary ? (
              <>
                <div className="pos-metric-strip" style={{ marginBottom: 16 }}>
                  <div className="metric">
                    <div className="metric-label">{tt("restMetricBills")}</div>
                    <div className="metric-value">{summary.billing?.billCount || 0}</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">{tt("restMetricGross")}</div>
                    <div className="metric-value">{formatBDT(summary.billing?.grossTotal || 0)}</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">{tt("restMetricCollected")}</div>
                    <div className="metric-value">{formatBDT(summary.billing?.paidTotal || 0)}</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">{tt("restMetricDue")}</div>
                    <div className="metric-value">{formatBDT(summary.billing?.dueTotal || 0)}</div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">{tt("restMetricKot")}</div>
                    <div className="metric-value">{summary.kot?.total || 0}</div>
                  </div>
                </div>
                <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
                  {tt("restSummaryModes", {
                    dineIn: summary.billing?.dineInBills || 0,
                    takeaway: summary.billing?.takeawayBills || 0,
                  })}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  <div className="page-card" style={{ margin: 0, padding: 12 }}>
                    <strong>{tt("restTables")}</strong>
                    <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                      {tt("restTableStatusFree")}: {summary.tables?.FREE || 0} · {tt("restTableStatusOccupied")}:{" "}
                      {summary.tables?.OCCUPIED || 0} · {tt("restTableStatusBilling")}: {summary.tables?.BILLING || 0}
                    </p>
                  </div>
                  <div className="page-card" style={{ margin: 0, padding: 12 }}>
                    <strong>{tt("restKitchenQueue")}</strong>
                    <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                      {tt("restStatusPreparing")}: {summary.kot?.PREPARING || 0} · {tt("restStatusReady")}:{" "}
                      {summary.kot?.READY || 0} · {tt("restStatusServed")}: {summary.kot?.SERVED || 0}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted">{tt("restSummaryEmpty")}</p>
            )}
          </div>

          {summary?.billing?.byPayment?.length ? (
            <div className="page-card">
              <h4 style={{ marginTop: 0 }}>{tt("restCollectionByPayment")}</h4>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{tt("posPayMethod")}</th>
                    <th>{tt("restMetricCollected")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.billing.byPayment.map((row) => (
                    <tr key={row.method}>
                      <td>{row.method}</td>
                      <td>{formatBDT(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {summary?.billing?.byTable?.length ? (
            <div className="page-card">
              <h4 style={{ marginTop: 0 }}>{tt("restSalesByTable")}</h4>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{tt("restSelectedTable")}</th>
                    <th>{tt("restMetricBills")}</th>
                    <th>{tt("restMetricGross")}</th>
                    <th>{tt("restMetricCollected")}</th>
                    <th>{tt("restMetricDue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.billing.byTable.map((row) => (
                    <tr key={`${row.tableId}-${row.tableName}`}>
                      <td>{row.tableName}</td>
                      <td>{row.bills}</td>
                      <td>{formatBDT(row.gross)}</td>
                      <td>{formatBDT(row.paid)}</td>
                      <td>{formatBDT(row.due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {summary?.billing?.recentBills?.length ? (
            <div className="page-card">
              <h4 style={{ marginTop: 0 }}>{tt("restRecentBills")}</h4>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{tt("receiptInvoice")}</th>
                    <th>{tt("restSelectedTable")}</th>
                    <th>{tt("receiptTotal")}</th>
                    <th>{tt("receiptPaid")}</th>
                    <th>{tt("receiptDue")}</th>
                    <th>{tt("posPayMethod")}</th>
                    <th>{tt("receiptDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.billing.recentBills.map((bill) => (
                    <tr key={bill.id}>
                      <td>{bill.invoiceNo}</td>
                      <td>
                        {bill.serviceMode === "DINE_IN"
                          ? bill.tableName || tt("restSelectedTable")
                          : tt("restTakeaway")}
                      </td>
                      <td>{formatBDT(bill.total)}</td>
                      <td>{formatBDT(bill.paidAmount)}</td>
                      <td>{formatBDT(bill.dueAmount)}</td>
                      <td>{bill.paymentMethod}</td>
                      <td>{new Date(bill.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <p className="text-muted" style={{ fontSize: 12 }}>
            {tt("restSummaryHelp")}
          </p>
        </>
      ) : null}

      {tab === "floor" ? (
        <>
          {!tables.length ? (
            <div className="page-card">
              <p className="text-muted">{tt("restNoTables")}</p>
              <button type="button" className="btn-primary btn-sm" disabled={busy || !canSeed} onClick={seedTables}>
                {tt("restSeedTables")}
              </button>
            </div>
          ) : (
            <>
            <div className="page-card">
              <div className="rest-table-legend" aria-label={tt("restTableLegend")}>
                <span className="rest-legend-item rest-table-free">{tt("restTableStatusFree")}: {tableCounts.FREE}</span>
                <span className="rest-legend-item rest-table-occupied">{tt("restTableStatusOccupied")}: {tableCounts.OCCUPIED}</span>
                <span className="rest-legend-item rest-table-billing">{tt("restTableStatusBilling")}: {tableCounts.BILLING}</span>
              </div>
              <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 12px" }}>{tt("restTableFlowHelp")}</p>
              <h4 style={{ marginTop: 0 }}>{tt("restTables")}</h4>
              <div className="rest-table-grid">
                {tables.map((table) => (
                  <button
                    key={table.id}
                    type="button"
                    className={`rest-table-chip ${tableStatusClass(table.status)} ${selectedTable?.id === table.id ? "rest-table-selected" : ""}`}
                    onClick={() => selectTable(table)}
                  >
                    <strong>{table.name || table.code}</strong>
                    <span>{tableStatusLabel(table.status)}</span>
                    {table.openKotCount > 0 ? (
                      <span style={{ fontSize: 10, color: "#b45309" }}>
                        {tt("restOpenKots", { n: table.openKotCount })}
                      </span>
                    ) : null}
                    {table.capacity ? (
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>
                        {table.capacity} {tt("restSeats")}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            {selectedTable ? (
              <div className="page-card rest-table-actions">
                <h4 style={{ marginTop: 0 }}>
                  {selectedTable.name || selectedTable.code} — {tableStatusLabel(selectedTable.status)}
                </h4>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selectedTable.status === "FREE" ? (
                    <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => runTableAction("seat")}>
                      {tt("restSeatGuests")}
                    </button>
                  ) : null}
                  {selectedTable.status === "OCCUPIED" ? (
                    <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => runTableAction("bill")}>
                      {tt("restRequestBill")}
                    </button>
                  ) : null}
                  {selectedTable.status === "BILLING" ? (
                    <button type="button" className="btn-success btn-sm" disabled={busy} onClick={() => runTableAction("collected")}>
                      {tt("restBillCollected")}
                    </button>
                  ) : null}
                  {selectedTable.status !== "FREE" ? (
                    <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => runTableAction("free")}>
                      {tt("restMarkFree")}
                    </button>
                  ) : null}
                </div>
                <p className="text-muted" style={{ fontSize: 12, marginBottom: 0 }}>
                  {tt("restCollectOnPosHint")}
                </p>
                <div className="rest-table-qr-panel" style={{ marginTop: 16 }}>
                  <h5 style={{ margin: "0 0 8px" }}>{tt("restTableOrderQr")}</h5>
                  {storefrontToken ? (
                    <>
                      <p className="text-muted" style={{ fontSize: 12, marginTop: 0 }}>
                        {tt("restTableOrderQrHelp")}
                      </p>
                      <div className="storefront-settings-qr">
                        <QrCodeImage
                          value={buildStorefrontUrl(storefrontToken, { table: selectedTable.code })}
                          size={160}
                          alt={tt("restTableOrderQr")}
                        />
                        <div style={{ fontSize: 12 }}>
                          <code style={{ wordBreak: "break-all" }}>
                            {buildStorefrontUrl(storefrontToken, { table: selectedTable.code })}
                          </code>
                          <div style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => copyTableOrderLink(selectedTable)}
                            >
                              {tt("restCopyTableLink")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                      {tt("restNoStorefrontToken")}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
            </>
          )}

          <div className="page-card">
            <h4 style={{ marginTop: 0 }}>{tt("restNewKot")}</h4>
            <p className="text-muted" style={{ fontSize: 13 }}>
              {selectedTable ? `${tt("restSelectedTable")}: ${selectedTable.name}` : tt("restTakeaway")}
            </p>
            {kotLines.map((line, idx) => (
              <div key={idx} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <SearchSelect
                  className="form-select-sm"
                  value={line.productId}
                  onChange={(val) =>
                    setKotLines((prev) => prev.map((x, i) => (i === idx ? { ...x, productId: val } : x)))
                  }
                  placeholder={tt("restPickItem")}
                  options={products.map((p) => ({ value: String(p.id), label: p.name }))}
                />
                <input
                  type="number"
                  min={1}
                  style={{ width: 72 }}
                  value={line.qty}
                  onChange={(e) =>
                    setKotLines((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))
                  }
                />
                <input
                  placeholder={tt("restItemNotes")}
                  value={line.notes}
                  onChange={(e) =>
                    setKotLines((prev) => prev.map((x, i) => (i === idx ? { ...x, notes: e.target.value } : x)))
                  }
                />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setKotLines((prev) => [...prev, { productId: "", qty: 1, notes: "" }])}
              >
                + {tt("restAddLine")}
              </button>
              <button type="button" className="btn-primary btn-sm" disabled={busy || !canOperate} onClick={sendKot}>
                {tt("restSendKot")}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {tab === "kitchen" ? (
        <div className="page-card">
          <h4 style={{ marginTop: 0 }}>{tt("restKitchenQueue")}</h4>
          {tickets.length === 0 ? (
            <p className="text-muted">{tt("restNoTickets")}</p>
          ) : (
            tickets.map((ticket) => (
              <div key={ticket.id} className="rest-kot-card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>
                    {ticket.ticketNo} · {ticket.table?.name || tt("restTakeaway")} · {ticket.status}
                  </strong>
                  <span className="text-muted">{new Date(ticket.createdAt).toLocaleTimeString()}</span>
                </div>
                <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
                  {(ticket.items || []).map((item, i) => (
                    <li key={i}>
                      {item.qty}x {item.name}
                      {item.notes ? ` (${item.notes})` : ""}
                    </li>
                  ))}
                </ul>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {ticket.status === "OPEN" ? (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => updateKotStatus(ticket.id, "PREPARING")}>
                      {tt("restStatusPreparing")}
                    </button>
                  ) : null}
                  {ticket.status === "PREPARING" ? (
                    <button type="button" className="btn-secondary btn-sm" onClick={() => updateKotStatus(ticket.id, "READY")}>
                      {tt("restStatusReady")}
                    </button>
                  ) : null}
                  {ticket.status === "READY" ? (
                    <button type="button" className="btn-primary btn-sm" onClick={() => updateKotStatus(ticket.id, "SERVED")}>
                      {tt("restStatusServed")}
                    </button>
                  ) : null}
                  <button type="button" className="btn-secondary btn-sm" onClick={() => printKot(ticket.id)}>
                    {tt("restPrintKot")}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default Restaurant;
