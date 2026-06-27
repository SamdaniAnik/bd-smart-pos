import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Manages state for a server-driven DataTable: pagination, sorting and
 * per-column search/filters, plus the fetch lifecycle.
 *
 * @param {(query) => Promise<{ data: any[], total: number }>} fetcher
 *        Receives the current query and returns the paged result envelope.
 * @param {object} [options]
 * @param {number} [options.pageSize=10]
 * @param {string} [options.sortKey]
 * @param {"asc"|"desc"} [options.sortDir="desc"]
 */
export default function useServerTable(fetcher, options = {}) {
  const { pageSize = 10, sortKey = "", sortDir = "desc" } = options;

  const [query, setQuery] = useState({
    page: 1,
    pageSize,
    sortKey,
    sortDir,
    search: {},
    filters: {},
  });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestId = useRef(0);

  const load = useCallback(async (q) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current(q);
      if (id !== requestId.current) return; // a newer request superseded this one
      setRows(Array.isArray(result?.data) ? result.data : []);
      setTotal(Number(result?.total) || 0);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err);
      setRows([]);
      setTotal(0);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(query);
  }, [query, load]);

  // Called by DataTable's onQueryChange — merges the reported query slice.
  const onQueryChange = useCallback((next) => {
    setQuery((prev) => ({ ...prev, ...next }));
  }, []);

  const refresh = useCallback(() => load(query), [load, query]);

  return {
    rows,
    total,
    loading,
    error,
    query,
    setQuery,
    onQueryChange,
    refresh,
  };
}
