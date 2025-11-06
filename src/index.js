// server.js
import express from "express";
import "dotenv/config";
import { connectDB } from "./lib/db.js";
import authRoutes from "./routes/authRoutes.js";
import authPayments from "./routes/authPayment.js";
import authAccounts from "./routes/authAccount.js";
import authTransactions from "./routes/authTransactions.js";
import authWallet from "./routes/authWallet.js";
import job from "./lib/cron.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Start cron job
job.start();

// Middleware
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/payments", authPayments);
app.use("/api/accounts", authAccounts);
app.use("/api/transactions", authTransactions);
app.use("/api/wallet", authWallet);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "✅ Server is running" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: `Endpoint not found: ${req.method} ${req.path}`,
    availableRoutes: [
      "GET /api/health",
      "POST /api/auth/register",
      "POST /api/auth/login",
      "GET /api/accounts/getUserAccount",
      "POST /api/accounts/setup",
      "GET /api/transactions",
      "POST /api/transactions/deposit",
      "POST /api/transactions/withdraw",
      "POST /api/transactions/transfer",
      "GET /api/wallet/balance",
      "GET /api/wallet/stats",
      "GET /api/wallet/recent",
      "POST /api/payments/initiate",
    ],
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  connectDB();
});

export default app;
