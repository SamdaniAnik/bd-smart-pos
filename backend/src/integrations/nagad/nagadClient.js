const crypto = require("crypto");
const { fetchJson } = require("../httpClient");

function nagadBaseUrl() {
  const env = String(process.env.NAGAD_APP_ENV || process.env.NAGAD_ENV || "sandbox").toLowerCase();
  if (env === "production") return "https://api.mynagad.com/api/dfs/";
  return String(
    process.env.NAGAD_BASE_URL || "http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs/"
  );
}

function wrapPem(raw, label) {
  const body = String(raw || "")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body) return "";
  const chunks = body.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${chunks.join("\n")}\n-----END ${label}-----`;
}

function merchantPrivateKey() {
  return wrapPem(process.env.NAGAD_MERCHANT_PRIVATE_KEY, "RSA PRIVATE KEY");
}

function pgPublicKey() {
  return wrapPem(process.env.NAGAD_PG_PUBLIC_KEY, "PUBLIC KEY");
}

function encryptWithPublicKey(jsonText) {
  const encrypted = crypto.publicEncrypt(
    { key: pgPublicKey(), padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(jsonText, "utf8")
  );
  return encrypted.toString("base64");
}

function decryptWithPrivateKey(base64Text) {
  const decrypted = crypto.privateDecrypt(
    { key: merchantPrivateKey(), padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(base64Text, "base64")
  );
  return decrypted.toString("utf8");
}

function signJson(jsonText) {
  const signature = crypto.sign("sha256", Buffer.from(jsonText, "utf8"), merchantPrivateKey());
  return signature.toString("base64");
}

function randomChallenge(len = 40) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

function nagadDateTime() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
}

function nagadHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-KM-Api-Version": "v-0.2.0",
    "X-KM-IP-V4": process.env.NAGAD_CLIENT_IP || "127.0.0.1",
    "X-KM-Client-Type": "PC_WEB",
  };
}

function ensureNagadConfigured() {
  const merchantId = process.env.NAGAD_MERCHANT_ID;
  if (!merchantId || !process.env.NAGAD_MERCHANT_PRIVATE_KEY || !process.env.NAGAD_PG_PUBLIC_KEY) {
    throw new Error("Nagad credentials missing (NAGAD_MERCHANT_ID, NAGAD_MERCHANT_PRIVATE_KEY, NAGAD_PG_PUBLIC_KEY)");
  }
  return merchantId;
}

async function nagadPost(path, payload) {
  const url = `${nagadBaseUrl()}${path}`;
  return fetchJson(url, {
    method: "POST",
    headers: nagadHeaders(),
    body: JSON.stringify(payload),
  });
}

async function nagadCreatePayment({ amount, invoiceRef, callbackUrl }) {
  const merchantId = ensureNagadConfigured();
  const orderId = String(invoiceRef || `NAGAD-${Date.now()}`).slice(0, 40);
  const dateTime = nagadDateTime();
  const initSensitive = {
    merchantId,
    datetime: dateTime,
    orderId,
    challenge: randomChallenge(40),
  };
  const initPayload = {
    accountNumber: process.env.NAGAD_MERCHANT_NUMBER || process.env.NAGAD_ACCOUNT_NUMBER || undefined,
    dateTime,
    sensitiveData: encryptWithPublicKey(JSON.stringify(initSensitive)),
    signature: signJson(JSON.stringify(initSensitive)),
  };

  const initRes = await nagadPost(`check-out/initialize/${merchantId}/${orderId}`, initPayload);
  if (!initRes?.sensitiveData) {
    throw new Error(initRes?.message || initRes?.reason || "Nagad initialize failed");
  }

  const plainInit = JSON.parse(decryptWithPrivateKey(initRes.sensitiveData));
  const paymentReferenceId = plainInit.paymentReferenceId;
  const challenge = plainInit.challenge;
  if (!paymentReferenceId || !challenge) throw new Error("Nagad initialize response missing paymentReferenceId");

  const completeSensitive = {
    merchantId,
    orderId,
    currencyCode: process.env.NAGAD_CURRENCY_CODE || "050",
    amount: Number(amount).toFixed(2),
    challenge,
  };
  const completePayload = {
    sensitiveData: encryptWithPublicKey(JSON.stringify(completeSensitive)),
    signature: signJson(JSON.stringify(completeSensitive)),
    merchantCallbackURL: callbackUrl || process.env.NAGAD_CALLBACK_URL || process.env.BKASH_CALLBACK_URL,
  };

  const completeRes = await nagadPost(`check-out/complete/${paymentReferenceId}`, completePayload);
  if (String(completeRes?.status || "").toLowerCase() !== "success") {
    throw new Error(completeRes?.message || "Nagad checkout complete failed");
  }

  return {
    providerPaymentId: paymentReferenceId,
    paymentUrl: completeRes.callBackUrl || completeRes.callbackUrl || null,
    qrPayload: completeRes.callBackUrl || completeRes.callbackUrl || null,
  };
}

async function nagadVerifyPayment(paymentReferenceId, trxId) {
  ensureNagadConfigured();
  const ref = String(paymentReferenceId || "").trim();
  if (!ref) throw new Error("Nagad paymentReferenceId is required");

  const url = `${nagadBaseUrl()}verify/payment/${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `Nagad verify failed (${res.status})`);

  const status = String(body.status || body.statusCode || "").toLowerCase();
  const ok = status === "success" || status === "000" || status.startsWith("00");
  if (!ok) throw new Error(body.message || body.status || "Nagad payment not successful");

  const issuerRef = body.issuerPaymentRefNo || body.issuerPaymentReference || trxId;
  if (trxId && issuerRef && String(issuerRef).toUpperCase() !== String(trxId).toUpperCase()) {
    throw new Error("Nagad TrxID does not match verified payment");
  }

  return {
    verified: true,
    trxId: issuerRef || trxId,
    amount: Number(body.amount || 0),
  };
}

module.exports = {
  nagadCreatePayment,
  nagadVerifyPayment,
  ensureNagadConfigured,
};
