const crypto = require("crypto");
const prisma = require("../../utils/prisma");
const { buildCustomerLoyaltyBalance } = require("../../utils/loyaltyPointsExpiry");
const { sendSms, normalizeBdPhone, renderSmsTemplate, isSmsConfigured, getProviderName, getSmsTemplateBody } = require("../../utils/smsGateway");

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

function hashOtp(otp) {
  const salt = process.env.LOYALTY_OTP_SALT || process.env.JWT_SECRET || "bd-smart-pos";
  return crypto.createHash("sha256").update(`${salt}:${String(otp)}`).digest("hex");
}

// Best-effort cleanup of expired OTP sessions (DB-backed, survives restart).
async function pruneOtpSessions() {
  try {
    await prisma.loyaltyOtpSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch {
    /* non-fatal */
  }
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function resolveCustomerByCardToken(cardToken) {
  const token = String(cardToken || "").trim();
  if (!token) return null;
  return prisma.customer.findFirst({
    where: { loyaltyCardToken: token },
    select: { id: true, branchId: true, name: true, phone: true, loyaltyCardToken: true },
  });
}

exports.requestLoyaltyOtp = async (req, res) => {
  try {
    await pruneOtpSessions();
    const cardToken = String(req.body?.cardToken || req.body?.token || "").trim();
    const phoneRaw = String(req.body?.phone || "").trim();
    const customer = await resolveCustomerByCardToken(cardToken);
    if (!customer) return res.status(404).json({ error: "Invalid loyalty card" });
    if (!customer.phone) return res.status(400).json({ error: "No phone on file for this card — ask staff to update customer profile" });

    const normalized = normalizeBdPhone(phoneRaw || customer.phone);
    const onFile = normalizeBdPhone(customer.phone);
    if (normalized !== onFile) {
      return res.status(400).json({ error: "Phone number does not match loyalty card" });
    }

    const otp = generateOtp();
    // One active OTP per (customer, card): clear any prior unverified sessions.
    await prisma.loyaltyOtpSession.deleteMany({
      where: { customerId: customer.id, cardToken, verified: false },
    });
    await prisma.loyaltyOtpSession.create({
      data: {
        branchId: customer.branchId,
        customerId: customer.id,
        cardToken,
        phone: normalized,
        otpHash: hashOtp(otp),
        attempts: 0,
        verified: false,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    const branch = await prisma.branch.findUnique({
      where: { id: customer.branchId },
      select: { name: true },
    });
    const templateBody = await getSmsTemplateBody(
      customer.branchId,
      "LOYALTY_OTP",
      process.env.LOYALTY_OTP_SMS_TEMPLATE || "{store}: আপনার লয়ালটি OTP {otp}। ১০ মিনিটের মধ্যে ব্যবহার করুন।"
    );
    const message = renderSmsTemplate(templateBody, {
      store: branch?.name || "BD Smart POS",
      otp,
      name: customer.name || "গ্রাহক",
    });

    const sms = await sendSms({ to: normalized, message, branchId: customer.branchId, customerId: customer.id, purpose: "LOYALTY_OTP" });
    res.json({
      message: isSmsConfigured() ? "OTP sent via SMS" : "OTP simulated (configure SMS_PROVIDER)",
      provider: getProviderName(),
      maskedPhone: `${normalized.slice(0, 3)}****${normalized.slice(-3)}`,
      expiresInSec: OTP_TTL_MS / 1000,
      simulatedOtp: isSmsConfigured() ? undefined : otp,
      smsStatus: sms.status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.verifyLoyaltyOtp = async (req, res) => {
  try {
    await pruneOtpSessions();
    const cardToken = String(req.body?.cardToken || req.body?.token || "").trim();
    const phoneRaw = String(req.body?.phone || "").trim();
    const otp = String(req.body?.otp || "").trim();
    const customer = await resolveCustomerByCardToken(cardToken);
    if (!customer) return res.status(404).json({ error: "Invalid loyalty card" });

    const session = await prisma.loyaltyOtpSession.findFirst({
      where: { customerId: customer.id, cardToken, verified: false },
      orderBy: { id: "desc" },
    });
    if (!session || new Date() > new Date(session.expiresAt)) {
      return res.status(400).json({ error: "OTP expired — request a new code" });
    }
    if (Number(session.attempts || 0) >= MAX_OTP_ATTEMPTS) {
      await prisma.loyaltyOtpSession.delete({ where: { id: session.id } }).catch(() => {});
      return res.status(429).json({ error: "Too many attempts — request a new code" });
    }
    const normalized = normalizeBdPhone(phoneRaw || customer.phone);
    if (normalizeBdPhone(customer.phone) !== normalized) {
      return res.status(400).json({ error: "Phone number does not match" });
    }
    if (hashOtp(otp) !== session.otpHash) {
      await prisma.loyaltyOtpSession.update({
        where: { id: session.id },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ error: "Invalid OTP" });
    }

    await prisma.loyaltyOtpSession.update({
      where: { id: session.id },
      data: { verified: true },
    });

    const balance = await buildCustomerLoyaltyBalance(prisma, customer.branchId, customer.id);
    const branch = await prisma.branch.findUnique({
      where: { id: customer.branchId },
      select: { name: true, loyaltyPointsExpiryDays: true },
    });

    res.json({
      customerName: customer.name,
      storeName: branch?.name || "",
      availablePoints: balance.availablePoints,
      earnedPoints: balance.earnedPoints,
      expiringSoonPoints: balance.expiringSoonPoints,
      pointsExpiryDays: balance.pointsExpiryDays,
      totalSpent: balance.totalSpent,
      orders: balance.orders,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getLoyaltyCardInfo = async (req, res) => {
  try {
    const cardToken = String(req.query?.token || req.query?.card || "").trim();
    const customer = await resolveCustomerByCardToken(cardToken);
    if (!customer) return res.status(404).json({ error: "Invalid loyalty card" });
    const branch = await prisma.branch.findUnique({
      where: { id: customer.branchId },
      select: { name: true },
    });
    const phone = normalizeBdPhone(customer.phone || "");
    res.json({
      storeName: branch?.name || "",
      customerName: customer.name,
      maskedPhone: phone ? `${phone.slice(0, 3)}****${phone.slice(-3)}` : null,
      requiresOtp: true,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.issueLoyaltyCardToken = () => crypto.randomBytes(16).toString("hex");
