import api from "./api";

/**
 * @param {string} type — products | customers | suppliers | branches | warehouses | users | categories | purchases
 * @param {{ q?: string, limit?: number, id?: string|number, [key: string]: unknown }} params
 */
export async function fetchLookup(type, params = {}) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", String(params.q));
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.id != null && params.id !== "") query.set("id", String(params.id));
  Object.entries(params).forEach(([key, value]) => {
    if (["q", "limit", "id"].includes(key)) return;
    if (value != null && value !== "") query.set(key, String(value));
  });
  const qs = query.toString();
  const res = await api.get(`/master/lookup/${type}${qs ? `?${qs}` : ""}`, {
    skipGlobalErrorToast: true,
  });
  return Array.isArray(res.data?.rows) ? res.data.rows : [];
}

export function mapLookupRows(rows) {
  return (rows || []).map((row) => ({
    value: String(row.value),
    label: String(row.label || row.value),
    raw: row.raw || null,
  }));
}

export async function loadLookupOptions(type, inputValue = "", extraParams = {}) {
  const rows = await fetchLookup(type, { q: inputValue, limit: 20, ...extraParams });
  return mapLookupRows(rows);
}

export async function resolveLookupOption(type, id, extraParams = {}) {
  if (id == null || id === "") return null;
  const rows = await fetchLookup(type, { id, ...extraParams });
  const mapped = mapLookupRows(rows);
  return mapped[0] || null;
}
