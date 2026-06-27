// IVAS / authorized-ERP upload abstraction for Mushak 9.1 monthly returns.
//
// NBR has not published a public self-filing API. Integrators file through the
// iVAS portal or an authorized ERP gateway. This module abstracts that upload so
// the rest of the app only deals with a single uploadMushak91() call. When no
// endpoint is configured it stays in "export-only" mode (returns simulated:true).

const { fetchJson } = require("../../integrations/httpClient");

function getMushak91Provider() {
  return String(process.env.EFD_MUSHAK91_PROVIDER || "log").trim().toLowerCase();
}

function isMushak91FilingConfigured() {
  return Boolean(String(process.env.EFD_MUSHAK91_URL || "").trim());
}

/**
 * Upload a prepared Mushak 9.1 payload to the configured IVAS/ERP endpoint.
 * @param {object} payload  Output of buildMushak91Payload()
 * @returns {Promise<{ ok, simulated, referenceNo, status, raw? }>}
 */
async function uploadMushak91(payload) {
  const provider = getMushak91Provider();
  const url = String(process.env.EFD_MUSHAK91_URL || "").trim();
  const apiKey = String(process.env.EFD_MUSHAK91_API_KEY || process.env.EFD_GENEX_API_KEY || "").trim();

  if (provider === "log" || !url || !apiKey) {
    return {
      ok: true,
      simulated: true,
      referenceNo: "",
      status: "EXPORT_ONLY",
    };
  }

  const body = await fetchJson(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Return-Form": "Mushak-9.1",
        "X-Tax-Period": payload.taxPeriod,
        ...(provider === "ivas" ? { "X-Filing-Channel": "IVAS" } : {}),
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 45000, retries: 1 }
  );

  return {
    ok: true,
    simulated: false,
    referenceNo: String(body.referenceNo || body.returnId || body.acknowledgementId || ""),
    status: String(body.status || "SUBMITTED"),
    raw: body,
  };
}

module.exports = { uploadMushak91, getMushak91Provider, isMushak91FilingConfigured };
