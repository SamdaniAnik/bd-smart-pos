const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const config = require("../utils/config");

const helmetMiddleware = helmet({
  // The frontend is served separately by Vite; we only emit JSON & PDFs here,
  // so a strict default CSP is fine. Tweak via env later if needed.
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // Force HTTPS for a year (incl. subdomains) once a client has seen us on TLS.
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  // Don't leak full URLs to third-party origins via the Referer header.
  referrerPolicy: { policy: "no-referrer" },
  // Disallow the API from being framed (clickjacking defense).
  frameguard: { action: "deny" },
});

function buildOriginChecker() {
  // If allow-list is empty in non-prod, mirror the request origin (open).
  // In prod, an empty allow-list means deny all browsers — safest default.
  const list = config.allowedOrigins;
  return function originChecker(origin, callback) {
    if (!origin) {
      // Same-origin / curl / mobile / server-to-server requests have no Origin header.
      return callback(null, true);
    }
    if (list.length === 0) {
      if (!config.isProd) return callback(null, true);
      return callback(new Error(`CORS: origin "${origin}" is not allowed`));
    }
    if (list.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin "${origin}" is not allowed`));
  };
}

const corsOptions = {
  origin: buildOriginChecker(),
  credentials: true,
  exposedHeaders: ["Content-Disposition"],
};

const loginRateLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
  skipSuccessfulRequests: true,
});

const bootstrapRateLimiter = rateLimit({
  windowMs: config.rateLimit.bootstrapWindowMs,
  max: config.rateLimit.bootstrapMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many seed attempts. Try again later." },
});

// Generous global ceiling so a single abusive IP can't flood the whole API.
const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.apiWindowMs,
  max: config.rateLimit.apiMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

// Strict ceiling for unauthenticated OTP requests (SMS cost / OTP bombing).
const otpRateLimiter = rateLimit({
  windowMs: config.rateLimit.otpWindowMs,
  max: config.rateLimit.otpMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many OTP requests. Try again later." },
});

module.exports = {
  helmetMiddleware,
  corsOptions,
  loginRateLimiter,
  bootstrapRateLimiter,
  apiRateLimiter,
  otpRateLimiter,
};
