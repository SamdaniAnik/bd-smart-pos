import { useEffect, useMemo, useState } from "react";
import { getLang, t } from "../i18n";

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
      <div className="datatable-surface">
        <div
          className={`datatable-card-head ${title ? "" : "datatable-card-head--toolbar-only"}`}
        >
          {title ? <h4 className="datatable-title">{title}</h4> : null}
          <div className="datatable-toolbar">
            <label className="datatable-page-size">
              <span className="datatable-page-size-label">{tt("dtRowsPerPage")}</span>
              <select
                className="form-select-sm"
                value={pageSizeState}
                onChange={(e) => {
                  setPageSizeState(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </label>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setShowColumnPicker((p) => !p)}>
              {tt("dtColumns")}
            </button>
            {allowExport ? (
              <button type="button" className="btn-secondary btn-sm" onClick={exportFilteredCSV}>
                {tt("dtExportCsv")}
              </button>
            ) : null}
          </div>
        </div>
        {showColumnPicker ? (
          <div className="datatable-column-picker">
            {columns.map((c) => (
              <label key={c.key} className="datatable-column-picker-item">
                <input type="checkbox" checked={!hiddenColumns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        ) : null}
        <div className="datatable-wrapper">
          <table className="datatable-table">
            <thead>
              <tr>
                {visibleColumns.map((c) => (
                  <th key={c.key} className="datatable-th-sortable" scope="col">
                    <button type="button" className="datatable-sort-btn" onClick={() => onSort(c.key)}>
                      <span>{c.label}</span>
                      <span className="datatable-sort-icon" aria-hidden>
                        {sortKey === c.key ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
              <tr className="datatable-filter-row">
                {visibleColumns.map((c) => {
                  const cfg = filterConfigMap[c.key];
                  if (c.key === "actions") {
                    return <th key={`${c.key}-filter`} className="datatable-th-filter" />;
                  }
                  return (
                    <th key={`${c.key}-filter`} className="datatable-th-filter" onClick={(e) => e.stopPropagation()}>
                      {cfg ? (
                        <select
                          className="form-select-sm datatable-header-filter"
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
                          placeholder={tt("dtFilterPlaceholder", { label: c.label })}
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
                <tr key={row.id ?? idx}>
                  {visibleColumns.map((c) => (
                    <td key={c.key} className={c.key === "actions" ? "actions-cell" : undefined}>
                      {c.render ? c.render(row[c.key], row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
              {!pagedRows.length ? (
                <tr>
                  <td colSpan={visibleColumns.length || 1} className="datatable-empty">
                    {tt("dtNoData")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="datatable-footer">
          <span className="datatable-footer-meta">
            <strong>{filteredRows.length}</strong> {tt("dtFooterRows")} · {tt("dtFooterPage", { page: safePage, total: totalPages })}
          </span>
          <div className="datatable-pagination">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPage(1)} disabled={safePage === 1}>
              {tt("dtFirst")}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>
              {tt("dtPrev")}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
            >
              {tt("dtNext")}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>
              {tt("dtLast")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DataTable;
