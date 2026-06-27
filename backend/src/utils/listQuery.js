// Shared helper for server-driven tables: parses pagination, sorting, and
// per-column search out of req.query and turns them into Prisma clauses.
//
// Query contract (all optional — when none are present the caller can keep
// returning a plain array for backward compatibility):
//   page       1-based page number
//   pageSize   rows per page (clamped to maxPageSize)
//   paged      "true" to force paged mode even without page/pageSize
//   sortKey    column to sort by (must be in sortableFields)
//   sortDir    "asc" | "desc"
//   q          global search string (matched across all searchableFields)
//   search     JSON object { field: text } — case-insensitive "contains"
//   filters    JSON object { field: value } — exact match (dropdowns/enums)

function safeParseObject(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseListQuery(
  req,
  {
    searchableFields = [],
    filterableFields = [],
    sortableFields = [],
    // Map of search key -> { relation, field } for "contains" search across a
    // related model, e.g. { supplierName: { relation: "supplier", field: "name" } }.
    relationSearch = {},
    defaultSort = "createdAt",
    defaultSortDir = "desc",
    defaultPageSize = 10,
    maxPageSize = 100,
  } = {}
) {
  const q = req.query || {};

  const hasPaging = q.page != null || q.pageSize != null;
  const paged = hasPaging || String(q.paged || "").toLowerCase() === "true";

  const page = Math.max(1, Number.parseInt(q.page, 10) || 1);
  let pageSize = Number.parseInt(q.pageSize, 10);
  if (!Number.isFinite(pageSize) || pageSize <= 0) pageSize = defaultPageSize;
  pageSize = Math.min(pageSize, maxPageSize);

  const searchObj = safeParseObject(q.search);
  const filterObj = safeParseObject(q.filters);

  const clauses = [];

  // Per-column "contains" search.
  for (const field of searchableFields) {
    const val = String(searchObj[field] ?? "").trim();
    if (val) clauses.push({ [field]: { contains: val } });
  }

  // "contains" search across a related model (e.g. supplier name).
  for (const [key, def] of Object.entries(relationSearch)) {
    if (!def || !def.relation || !def.field) continue;
    const val = String(searchObj[key] ?? "").trim();
    if (val) clauses.push({ [def.relation]: { is: { [def.field]: { contains: val } } } });
  }

  // Per-column exact filters (dropdowns / enums).
  for (const field of filterableFields) {
    const raw = filterObj[field];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    let val = raw;
    if (val === "true") val = true;
    else if (val === "false") val = false;
    clauses.push({ [field]: val });
  }

  // Global search across all searchable fields.
  const globalQ = String(q.q || "").trim();
  if (globalQ && searchableFields.length) {
    clauses.push({ OR: searchableFields.map((f) => ({ [f]: { contains: globalQ } })) });
  }

  const sortKey = sortableFields.includes(String(q.sortKey)) ? String(q.sortKey) : defaultSort;
  const dirRaw = String(q.sortDir || "").toLowerCase();
  const sortDir = dirRaw === "asc" ? "asc" : dirRaw === "desc" ? "desc" : defaultSortDir;
  const orderBy = sortKey ? { [sortKey]: sortDir } : undefined;

  return {
    paged,
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy,
    sortKey,
    sortDir,
    searchClauses: clauses,
  };
}

// Wraps rows + count into the standard paged envelope the frontend expects.
function pagedResult({ data, total, page, pageSize }) {
  const safeSize = pageSize > 0 ? pageSize : data.length || 1;
  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil((total || 0) / safeSize)),
  };
}

module.exports = { parseListQuery, pagedResult };
