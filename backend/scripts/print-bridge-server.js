/**
 * Minimal local print-bridge agent for BD Smart POS tills.
 *
 * Browsers cannot write to USB/serial thermal printers, so this tiny HTTP
 * server accepts ESC/POS payloads from the POS and forwards them to a
 * configured device (or logs in dev).
 *
 * Usage:
 *   npm run print-bridge
 *   # POS Settings → print bridge URL: http://localhost:9100/print
 *
 * Env:
 *   PRINT_BRIDGE_PORT  (default 9100)
 *   PRINTER_DEVICE     optional path — raw bytes appended when set
 */
const http = require("http");
const fs = require("fs");

const PORT = Number(process.env.PRINT_BRIDGE_PORT || 9100);
const DEVICE = String(process.env.PRINTER_DEVICE || "").trim();

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function handlePrint(payload) {
  let bytes;
  if (payload?.type === "raw" && payload.dataBase64) {
    bytes = Buffer.from(String(payload.dataBase64), "base64");
  } else if (payload?.type === "text" && payload.text != null) {
    const ESC = 0x1b;
    const GS = 0x1d;
    const text = String(payload.text);
    const body = Buffer.from(text, "utf8");
    bytes = Buffer.concat([
      Buffer.from([ESC, 0x40]),
      body,
      Buffer.from([0x0a, 0x0a, GS, 0x56, 0x00]),
    ]);
  } else {
    throw new Error("Expected { type: 'raw', dataBase64 } or { type: 'text', text }");
  }

  if (DEVICE) {
    fs.appendFileSync(DEVICE, bytes);
  } else {
    // Dev fallback: hex preview (first 64 bytes)
    const preview = bytes.subarray(0, 64).toString("hex");
    console.log(`[print-bridge] ${bytes.length} bytes${DEVICE ? "" : ` (no PRINTER_DEVICE) preview=${preview}…`}`);
  }
  return { bytes: bytes.length, device: DEVICE || null };
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "POST" && req.url === "/print") {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw.toString("utf8") || "{}");
      const result = handlePrint(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, device: DEVICE || null }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[print-bridge] listening on http://127.0.0.1:${PORT}/print`);
  if (DEVICE) console.log(`[print-bridge] forwarding to ${DEVICE}`);
  else console.log("[print-bridge] set PRINTER_DEVICE to write to a thermal printer");
});
