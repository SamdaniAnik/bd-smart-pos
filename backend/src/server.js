const express = require("express");
const cors = require("cors");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const pinoHttp = require("pino-http");

const config = require("./utils/config");
const logger = require("./utils/logger");
const {
  helmetMiddleware,
  corsOptions,
  loginRateLimiter,
  bootstrapRateLimiter,
  apiRateLimiter,
} = require("./middleware/security");

const productRoutes = require("./routes/productRoutes");
const saleRoutes = require("./routes/saleRoutes");
const fiscalRoutes = require("./routes/fiscalRoutes");
const authRoutes = require("./modules/auth/authRoutes");
const branchRoutes = require("./modules/branch/branchRoutes");
const inventoryRoutes = require("./modules/inventory/inventoryRoutes");
const purchaseRoutes = require("./modules/purchase/purchaseRoutes");
const accountingRoutes = require("./modules/accounting/accountingRoutes");
const reportRoutes = require("./modules/reports/reportRoutes");
const masterRoutes = require("./modules/master/masterRoutes");
const bootstrapRoutes = require("./modules/bootstrap/bootstrapRoutes");
const rbacRoutes = require("./modules/rbac/rbacRoutes");
const warehouseRoutes = require("./modules/warehouse/warehouseRoutes");
const expenseRoutes = require("./modules/expense/expenseRoutes");
const duesRoutes = require("./modules/dues/duesRoutes");
const shiftRoutes = require("./modules/shift/shiftRoutes");
const approvalRoutes = require("./modules/approvals/approvalRoutes");
const promotionRoutes = require("./modules/promotions/promotionRoutes");
const { setSocketInstance } = require("./socket");

const app = express();
const server = http.createServer(app);

const allowedOriginsList = config.allowedOrigins;
const io = new Server(server, {
  cors: {
    origin: function socketOriginCheck(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOriginsList.length === 0) {
        if (!config.isProd) return callback(null, true);
        return callback(new Error(`Socket.IO: origin "${origin}" not allowed`));
      }
      if (allowedOriginsList.includes(origin)) return callback(null, true);
      return callback(new Error(`Socket.IO: origin "${origin}" not allowed`));
    },
    credentials: true,
  },
});

setSocketInstance(io);

if (config.trustProxy !== false) {
  app.set("trust proxy", config.trustProxy);
}

app.use(
  pinoHttp({
    logger,
    genReqId: function genRequestId(req) {
      const headerId = req.headers["x-request-id"];
      if (typeof headerId === "string" && headerId.length > 0 && headerId.length <= 128) {
        return headerId;
      }
      return crypto.randomUUID();
    },
    customLogLevel: function pickLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage: function (req, res) {
      return `${req.method} ${req.url} ${res.statusCode}`;
    },
    customErrorMessage: function (req, res, err) {
      return `${req.method} ${req.url} ${res.statusCode}: ${err?.message || "error"}`;
    },
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
          userAgent: req.headers && req.headers["user-agent"],
        };
      },
    },
  })
);
app.use(helmetMiddleware);
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// Rate-limited routes (mounted before the general routers so the limiter wraps them).
app.use("/api", apiRateLimiter);
app.use("/api/auth/login", loginRateLimiter);
app.use("/api/bootstrap/seed", bootstrapRateLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/bootstrap", bootstrapRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/fiscal", fiscalRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/master", masterRoutes);
app.use("/api/rbac", rbacRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/dues", duesRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/pharmacy", require("./modules/pharmacy/pharmacyRoutes"));
app.use("/api/gift-cards", require("./modules/giftcard/giftCardRoutes"));
app.use("/api/finance", require("./modules/finance/financeRoutes"));
app.use("/api/cheques", require("./modules/cheque/chequeRoutes"));
app.use("/api/assets", require("./modules/assets/assetRoutes"));
app.use("/api/cost-centers", require("./modules/costcenter/costCenterRoutes"));
app.use("/api/petty-cash", require("./modules/pettycash/pettyCashRoutes"));
app.use("/api/integration/webhooks", require("./modules/integration/webhookRoutes"));
app.use("/api/nbr", require("./modules/nbr/nbrRoutes"));
app.use("/api/withholding", require("./modules/withholding/withholdingRoutes"));
app.use("/api/payments", require("./modules/payments/mfsPaymentRoutes"));
app.use("/api/efd", require("./modules/efd/efdRoutes"));
app.use("/api/restaurant", require("./modules/restaurant/restaurantRoutes"));
app.use("/api/serials", require("./modules/serial/serialRoutes"));
app.use("/api/billing", require("./modules/billing/billingRoutes"));
app.use("/api/manufacturing", require("./modules/manufacturing/manufacturingRoutes"));
app.use("/api/courier", require("./modules/courier/courierRoutes"));
app.use("/api/orders", require("./modules/orders/orderInboxRoutes"));
app.use("/api/topup", require("./modules/topup/topupRoutes"));
app.use("/api/fcommerce", require("./modules/fcommerce/fcommerceRoutes"));
app.use("/api/warranty", require("./modules/warranty/warrantyRoutes"));
app.use("/api/loyalty/public", require("./modules/loyalty/loyaltyPublicRoutes"));
app.use("/api/storefront", require("./modules/storefront/storefrontRoutes"));
app.use("/api/sms", require("./modules/sms/smsRoutes"));
app.use("/api/installments", require("./modules/installment/installmentRoutes"));
app.use("/api/imei", require("./modules/imei/imeiRoutes"));
app.use("/api/expiry-markdown", require("./modules/expiryMarkdown/expiryMarkdownRoutes"));

app.get("/", function (req, res) {
  res.send("BD Smart POS API is running");
});

// Surface CORS rejection as a JSON 403 (express default would print the error string).
app.use(function corsErrorHandler(err, req, res, next) {
  if (err && typeof err.message === "string" && err.message.startsWith("CORS:")) {
    return res.status(403).json({ error: err.message });
  }
  return next(err);
});

function customerDisplayRoom(branchId) {
  const id = Number(branchId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `customer-display:branch:${id}`;
}

io.on("connection", function (socket) {
  logger.debug({ socketId: socket.id }, "POS client connected");

  socket.on("customerDisplay:join", function (payload) {
    const room = customerDisplayRoom(payload && payload.branchId);
    if (!room) return;
    socket.join(room);
  });

  socket.on("customerDisplay:leave", function (payload) {
    const room = customerDisplayRoom(payload && payload.branchId);
    if (!room) return;
    socket.leave(room);
  });

  socket.on("customerDisplay:state", function (payload) {
    if (!payload || typeof payload !== "object") return;
    const room = customerDisplayRoom(payload.branchId);
    if (!room) return;
    socket.to(room).emit("customerDisplay:state", payload);
  });

  socket.on("disconnect", function () {
    logger.debug({ socketId: socket.id }, "POS client disconnected");
  });
});

server.on("error", function (err) {
  if (err && err.code === "EADDRINUSE") {
    logger.fatal(
      {
        port: config.port,
        code: err.code,
        hint: `Another process is using port ${config.port}. Run: lsof -nP -iTCP:${config.port} -sTCP:LISTEN  then kill that PID, or set PORT=5002 in backend/.env`,
      },
      `Cannot start: port ${config.port} is already in use (EADDRINUSE)`
    );
    process.exit(1);
    return;
  }
  logger.fatal({ err }, "HTTP server error");
  process.exit(1);
});

server.listen(config.port, function () {
  logger.info(
    {
      port: config.port,
      env: config.env,
      allowedOrigins:
        allowedOriginsList.length === 0
          ? config.isProd
            ? "<deny-all>"
            : "<dev-open>"
          : allowedOriginsList,
    },
    `Server running on http://127.0.0.1:${config.port}`
  );

  // Background EFD fiscalization retry sweeper (no-op unless EFD provider configured).
  try {
    require("./modules/efd/efdRetryQueue").start();
  } catch (err) {
    logger.error({ err: err.message }, "Failed to start EFD retry sweeper");
  }
});

process.on("unhandledRejection", function (err) {
  logger.error({ err }, "Unhandled promise rejection");
});
process.on("uncaughtException", function (err) {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});
