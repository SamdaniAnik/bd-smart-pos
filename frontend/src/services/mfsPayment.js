import api from "./api";

const MFS_METHODS = new Set(["bKash", "Nagad", "Rocket", "Upay"]);

export function isMfsTender(method) {
  return MFS_METHODS.has(String(method || ""));
}

export async function initiateMfsPayment({ method, amount, invoiceRef }) {
  const res = await api.post("/payments/mfs/initiate", { method, amount, invoiceRef });
  return res.data;
}

export async function verifyMfsPayment({ paymentId, trxId }) {
  const res = await api.post("/payments/mfs/verify", { paymentId, trxId });
  return res.data;
}

export async function getMfsPaymentStatus(paymentId) {
  const res = await api.get(`/payments/mfs/${encodeURIComponent(paymentId)}`);
  return res.data;
}
