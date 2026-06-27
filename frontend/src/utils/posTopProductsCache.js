const CACHE_KEY = "bd_pos_top_products_cache_v1";

export function writeTopProductsCache(payload) {
  if (typeof localStorage === "undefined" || !payload) return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        fetchedAt: Date.now(),
        days: payload.days,
        rows: Array.isArray(payload.rows) ? payload.rows : [],
      })
    );
  } catch {
    /* quota */
  }
}

export function readTopProductsCache() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}
