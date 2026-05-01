import { useMemo, useState } from "react";

function normalize(v) {
  return String(v ?? "").toLowerCase();
}

function DataTable({
  title,
  columns,
  rows,
  filters = [],
  pageSize = 8,
  allowExport = true,
}) {
  const [sortKey, setSortKey] = useState(columns[0]?.key || "");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSizeState, setPageSizeState] = useState(pageSize);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState([]);
  const [columnFilters, setColumnFilters] = useState({});
  const visibleColumns = columns.filter((c) => !hiddenColumns.includes(c.key));
  const filterConfigMap = useMemo(
    () => Object.fromEntries(filters.map((f) => [f.key, f])),
    [filters]
  );

  const filteredRows = useMemo(() => {
    let result = [...rows];
    const activeFilterEntries = Object.entries(columnFilters).filter(
      ([, value]) => String(value || "").trim() !== ""
    );

    for (const [key, value] of activeFilterEntries) {
      const cfg = filterConfigMap[key];
      if (cfg) {
        result = result.filter((row) => String(row[key] ?? "") === String(value));
      } else {
        const q = normalize(value);
        result = result.filter((row) => normalize(row[key]).includes(q));
      }
    }

    if (sortKey) {
      result.sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return sortDir === "asc" ? -1 : 1;
        if (bv == null) return sortDir === "asc" ? 1 : -1;
        if (typeof av === "number" && typeof bv === "number") {
          return sortDir === "asc" ? av - bv : bv - av;
        }
        return sortDir === "asc"
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }

    return result;
  }, [rows, columnFilters, filterConfigMap, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSizeState));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((safePage - 1) * pageSizeState, safePage * pageSizeState);

  const onSort = (key) => {
    if (sortKey === key) {
      setSortDir((p) => (p === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const toggleColumn = (key) => {
    setHiddenColumns((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  };

  const exportFilteredCSV = () => {
    if (!filteredRows.length) return;
    const headers = visibleColumns.map((c) => c.label);
    const lines = [headers.join(",")];
    for (const row of filteredRows) {
      const values = visibleColumns.map((c) => {
        const raw = c.render ? c.render(row[c.key], row) : row[c.key];
        return `"${String(raw ?? "").replaceAll('"', '""')}"`;
      });
      lines.push(values.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "datatable").toLowerCase().replaceAll(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="datatable">
      {title ? <h4>{title}</h4> : null}
      <div className="datatable-toolbar">
        <select
          value={pageSizeState}
          onChange={(e) => {
            setPageSizeState(Number(e.target.value));
            setPage(1);
          }}
        >
          <option value={5}>5 rows</option>
          <option value={8}>8 rows</option>
          <option value={10}>10 rows</option>
          <option value={20}>20 rows</option>
          <option value={50}>50 rows</option>
        </select>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setShowColumnPicker((p) => !p)}>
          Columns
        </button>
        {allowExport ? (
          <button type="button" className="btn-secondary btn-sm" onClick={exportFilteredCSV}>
            Export CSV
          </button>
        ) : null}
      </div>
      {showColumnPicker ? (
        <div className="datatable-column-picker">
          {columns.map((c) => (
            <label key={c.key}>
              <input
                type="checkbox"
                checked={!hiddenColumns.includes(c.key)}
                onChange={() => toggleColumn(c.key)}
                style={{ width: "auto", marginRight: 6 }}
              />
              {c.label}
            </label>
          ))}
        </div>
      ) : null}
      <div className="datatable-wrapper">
        <table>
          <thead>
            <tr>
              {visibleColumns.map((c) => (
                <th key={c.key} onClick={() => onSort(c.key)} style={{ cursor: "pointer" }}>
                  {c.label} {sortKey === c.key ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
              ))}
            </tr>
            <tr>
              {visibleColumns.map((c) => {
                const cfg = filterConfigMap[c.key];
                if (c.key === "actions") {
                  return <th key={`${c.key}-filter`} />;
                }
                return (
                  <th key={`${c.key}-filter`} onClick={(e) => e.stopPropagation()}>
                    {cfg ? (
                      <select
                        className="datatable-header-filter"
                        value={columnFilters[c.key] || ""}
                        onChange={(e) => {
                          setColumnFilters((prev) => ({ ...prev, [c.key]: e.target.value }));
                          setPage(1);
                        }}
                      >
                        <option value="">{cfg.label}</option>
                        {cfg.options.map((o) => (
                          <option key={String(o.value)} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="datatable-header-filter"
                        placeholder={`Filter ${c.label}`}
                        value={columnFilters[c.key] || ""}
                        onChange={(e) => {
                          setColumnFilters((prev) => ({ ...prev, [c.key]: e.target.value }));
                          setPage(1);
                        }}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row, idx) => (
              <tr key={row.id || idx}>
                {visibleColumns.map((c) => (
                  <td key={c.key} className={c.key === "actions" ? "actions-cell" : undefined}>
                    {c.render ? c.render(row[c.key], row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
            {!pagedRows.length ? (
              <tr>
                <td colSpan={visibleColumns.length || 1} style={{ textAlign: "center", color: "var(--muted)", padding: "24px 12px" }}>
                  No data found
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="datatable-footer">
        <span>
          {filteredRows.length} rows • Page {safePage}/{totalPages}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn-secondary btn-sm" onClick={() => setPage(1)} disabled={safePage === 1}>
            First
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>
            Prev
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
          >
            Next
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>
            Last
          </button>
        </div>
      </div>
    </div>
  );
}

export default DataTable;
