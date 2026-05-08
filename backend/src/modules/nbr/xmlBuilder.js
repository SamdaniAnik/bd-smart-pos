// Tiny dependency-free XML builder used to emit Mushak 6.3 / 9.1 documents.
//
// We deliberately avoid a heavy XML library:
//   1. The output is small (a few KB per invoice).
//   2. NBR readers are tolerant — we just need well-formed UTF-8 XML.
//   3. The output must be canonical (stable byte-for-byte) so we can hash it.
//
// Element shape:
//   ["TagName", { attr1: "x" }, "text content"]
//   ["TagName", { attr1: "x" }, [child1, child2, ...]]
//   ["TagName", null, [...]]            // no attributes
//   ["TagName", { attr: "v" }]          // self-closing
// `null`/`undefined` children are skipped.

const ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

function isElement(node) {
  return Array.isArray(node) && typeof node[0] === "string";
}

function renderAttrs(attrs) {
  if (!attrs) return "";
  const keys = Object.keys(attrs).sort(); // canonical attribute order
  let out = "";
  for (const k of keys) {
    const v = attrs[k];
    if (v === null || v === undefined) continue;
    out += ` ${k}="${escapeXml(v)}"`;
  }
  return out;
}

function renderNode(node, indent, level) {
  if (node === null || node === undefined) return "";
  if (!isElement(node)) {
    // Text child
    return escapeXml(node);
  }
  const [tag, attrs, body] = node;
  const pad = indent ? indent.repeat(level) : "";
  const nl = indent ? "\n" : "";
  const attrStr = renderAttrs(attrs);

  if (body === null || body === undefined || body === "") {
    return `${pad}<${tag}${attrStr}/>`;
  }

  if (Array.isArray(body) && body.length > 0 && body.every((x) => x === null || x === undefined)) {
    return `${pad}<${tag}${attrStr}/>`;
  }

  if (Array.isArray(body)) {
    const childParts = [];
    for (const child of body) {
      if (child === null || child === undefined) continue;
      childParts.push(renderNode(child, indent, level + 1));
    }
    if (childParts.length === 0) return `${pad}<${tag}${attrStr}/>`;
    return `${pad}<${tag}${attrStr}>${nl}${childParts.join(nl)}${nl}${pad}</${tag}>`;
  }

  // Scalar text body — keep on the same line for compact output.
  return `${pad}<${tag}${attrStr}>${escapeXml(body)}</${tag}>`;
}

/**
 * Build a canonical XML document from the array tree above.
 *
 * @param {Array} root  Top-level element node.
 * @param {object} [options]
 * @param {boolean} [options.pretty=false] Indented output (do NOT use for hashing).
 * @returns {string}
 */
function buildXml(root, options = {}) {
  const { pretty = false } = options;
  const indent = pretty ? "  " : "";
  const body = renderNode(root, indent, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>${pretty ? "\n" : ""}${body}`;
}

module.exports = { buildXml, escapeXml };
