import { useEffect, useMemo, useRef, useState } from "react";
import { getLang, t } from "../i18n";
import useMediaQuery from "../hooks/useMediaQuery";
import SearchSelect from "./SearchSelect";

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
  // --- Server-driven mode (optional, backward compatible) ---
  // When `serverMode` is true the component renders `rows` verbatim and reports
  // query changes via `onQueryChange({ page, pageSize, sortKey, sortDir, search, filters })`.
  // The parent fetches data from the backend and passes back `rows` + `totalRows`.
  serverMode = false,
  onQueryChange,
  totalRows = 0,
  loading = false,
  initialSort = "",
  initialSortDir = "desc",
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
  const isCompact = useMediaQuery("(max-width: 768px)");

  const [sortKey, setSortKey] = useState(
    serverMode ? initialSort : columns[0]?.key || ""
  );
  const [sortDir, setSortDir] = useState(serverMode ? initialSortDir : "asc");
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

  const clientFilteredRows = useMemo(() => {
    if (serverMode) return rows;
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
  }, [serverMode, rows, columnFilters, filterConfigMap, sortKey, sortDir]);

  // In server mode the parent already filtered/sorted/paginated, so render rows
  // as-is and drive pagination from the server-reported total.
  const filteredRows = serverMode ? rows : clientFilteredRows;
  const totalCount = serverMode ? totalRows : clientFilteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSizeState));
  const safePage = serverMode ? Math.min(page, totalPages) : Math.min(page, totalPages);
  const pagedRows = serverMode
    ? rows
    : clientFilteredRows.slice((safePage - 1) * pageSizeState, safePage * pageSizeState);

  // Report query changes to the parent (server mode only). The first render is
  // skipped because the parent performs the initial fetch itself; subsequent
  // changes are debounced so rapid typing doesn't spam the backend.
  const firstEmit = useRef(true);
  const columnFiltersKey = useMemo(() => JSON.stringify(columnFilters), [columnFilters]);
  useEffect(() => {
    if (!serverMode || typeof onQueryChange !== "function") return undefined;
    if (firstEmit.current) {
      firstEmit.current = false;
      return undefined;
    }
    const handle = setTimeout(() => {
      const search = {};
      const filterValues = {};
      for (const [key, val] of Object.entries(columnFilters)) {
        if (String(val ?? "").trim() === "") continue;
        if (filterConfigMap[key]) filterValues[key] = val;
        else search[key] = val;
      }
      onQueryChange({
        page,
        pageSize: pageSizeState,
        sortKey,
        sortDir,
        search,
        filters: filterValues,
      });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMode, page, pageSizeState, sortKey, sortDir, columnFiltersKey]);

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
      <div className={`datatable-surface ${loading ? "datatable-surface--loading" : ""}`}>
        <div
          className={`datatable-card-head ${title ? "" : "datatable-card-head--toolbar-only"}`}
        >
          {title ? <h4 className="datatable-title">{title}</h4> : null}
          <div className="datatable-toolbar">
            <label className="datatable-page-size">
              <span className="datatable-page-size-label">{tt("dtRowsPerPage")}</span>
              <SearchSelect
                className="form-select-sm"
                value={String(pageSizeState)}
                onChange={(val) => {
                  setPageSizeState(Number(val || pageSizeState));
                  setPage(1);
                }}
                options={[
                  { value: "5", label: "5" },
                  { value: "8", label: "8" },
                  { value: "10", label: "10" },
                  { value: "20", label: "20" },
                  { value: "50", label: "50" },
                ]}
                isClearable={false}
              />
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
        {isCompact ? (
          <div className="datatable-mobile-list">
            {pagedRows.length ? (
              pagedRows.map((row, idx) => {
                const actionCol = visibleColumns.find((c) => c.key === "actions");
                const dataCols = visibleColumns.filter((c) => c.key !== "actions");
                return (
                  <article key={row.id ?? idx} className="datatable-mobile-card">
                    {dataCols.map((c) => {
                      const raw = c.render ? c.render(row[c.key], row) : row[c.key];
                      if (raw == null || raw === "") return null;
                      return (
                        <div key={c.key} className="datatable-mobile-row">
                          <span className="datatable-mobile-label">{c.label}</span>
                          <span className="datatable-mobile-value">{raw}</span>
                        </div>
                      );
                    })}
                    {actionCol ? (
                      <div className="datatable-mobile-actions">
                        {actionCol.render ? actionCol.render(row[actionCol.key], row) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <div className="datatable-empty datatable-mobile-empty">{tt("dtNoData")}</div>
            )}
          </div>
        ) : (
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
                  if (c.key === "actions" || c.searchable === false) {
                    return <th key={`${c.key}-filter`} className="datatable-th-filter" />;
                  }
                  return (
                    <th key={`${c.key}-filter`} className="datatable-th-filter" onClick={(e) => e.stopPropagation()}>
                      {cfg ? (
                        <SearchSelect
                          className="form-select-sm datatable-header-filter"
                          value={columnFilters[c.key] || ""}
                          onChange={(val) => {
                            setColumnFilters((prev) => ({ ...prev, [c.key]: val }));
                            setPage(1);
                          }}
                          placeholder={cfg.label}
                          options={cfg.options.map((o) => ({ value: o.value, label: o.label }))}
                        />
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
        )}
        <div className="datatable-footer">
          <span className="datatable-footer-meta">
            {loading ? (
              <span className="datatable-loading">{tt("dtLoading") || "Loading…"}</span>
            ) : null}
            <strong>{totalCount}</strong> {tt("dtFooterRows")} · {tt("dtFooterPage", { page: safePage, total: totalPages })}
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
