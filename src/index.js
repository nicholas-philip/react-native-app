import express from "express";
import "dotenv/config";
import { connectDB } from "./lib/db.js";
import authRoutes from "./routes/authRoutes.js";
import authPayments from "./routes/authPayment.js";
import authAccount from "./routes/authAccount.js";
import authTransactions from "./routes/authTransactions.js";
import authWallet from "./routes/authWallet.js";
import job from "./lib/cron.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Logging middleware for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint - BEFORE other routes
app.get("/api/health", (req, res) => {
  res.json({
    status: "✅ Server is running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    status: "Server root is working!",
    endpoints: {
      health: "/api/health",
      auth: "/api/auth",
      accounts: "/api/accounts",
      transactions: "/api/transactions",
      wallet: "/api/wallet",
      payments: "/api/payments",
    },
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/payments", authPayments);
app.use("/api/accounts", authAccount);
app.use("/api/transactions", authTransactions);
app.use("/api/wallet", authWallet);

// 404 handler - MUST BE AFTER ALL ROUTES
app.use((req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    message: `Endpoint not found: ${req.method} ${req.path}`,
    availableRoutes: [
      "GET /api/health",
      "POST /api/auth/register",
      "POST /api/auth/login",
      "GET /api/accounts/getUserAccount",
      "POST /api/accounts/setup",
      "GET /api/accounts/check",
      "GET /api/accounts/details",
      "PUT /api/accounts/update",
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

// Global error handler - MUST BE LAST
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// Start server
const startServer = async () => {
  try {
    // Connect to database first
    await connectDB();
    console.log("✅ Database connected");

    // Start the server
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(
        `📍 Server URL: ${process.env.API_URL || `http://localhost:${PORT}`}`
      );

      // Start cron job after server is ready
      if (process.env.NODE_ENV === "production") {
        job.start();
        console.log("✅ Cron job started");
      }
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Promise Rejection:", err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

startServer();

export default app;
