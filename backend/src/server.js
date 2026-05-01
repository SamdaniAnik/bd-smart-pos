const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const productRoutes = require("./routes/productRoutes");
const saleRoutes = require("./routes/saleRoutes");
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
const { setSocketInstance } = require("./socket");


require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

setSocketInstance(io);

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/bootstrap", bootstrapRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", saleRoutes);
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

app.get("/", function (req, res) {
  res.send("BD Smart POS API is running");
});


const PORT = 5001;

io.on("connection", function (socket) {
  console.log("POS client connected:", socket.id);
  socket.on("disconnect", function () {
    console.log("POS client disconnected:", socket.id);
  });
});

server.listen(PORT, function () {
  console.log("Server running on http://127.0.0.1:" + PORT);
});