import express from "express";
import "dotenv/config";
import { connectDB } from "./lib/db.js";
import authRoutes from "./routes/authRoutes.js";
import authPayments from "./routes/authPayment.js";
import authPaymentTransaction from "./routes/authPaymentTransaction.js";
import authAccount from "./routes/authAccount.js";
import authTransactions from "./routes/authTransactions.js";
import authWallet from "./routes/authWallet.js";
import job from "./lib/cron.js";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import helmet from "helmet";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ SECURITY HEADERS
app.use(helmet());

// ✅ REQUEST SIZE LIMIT
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// ✅ GLOBAL TIMEOUT - DEFAULT 120 SECONDS
app.use((req, res, next) => {
  req.setTimeout(120000); // 120 seconds default
  res.setTimeout(120000);
  next();
});

// ✅ EXTENDED TIMEOUT FOR EMAIL OPERATIONS (REGISTER & RESEND)
// These routes wait for email to send, so they need more time
app.post("/api/auth/register", (req, res, next) => {
  console.log(`⏱️ [TIMEOUT] Setting 120s timeout for /register`);
  req.setTimeout(120000); // 120 seconds for registration with email
  res.setTimeout(120000);
  next();
});

app.post("/api/auth/resend-verification", (req, res, next) => {
  console.log(`⏱️ [TIMEOUT] Setting 120s timeout for /resend-verification`);
  req.setTimeout(120000); // 120 seconds for resend with email
  res.setTimeout(120000);
  next();
});

// ✅ ADD REQUEST ID TO ALL REQUESTS
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-ID", req.id);
  next();
});

// ✅ GLOBAL RATE LIMITING
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health check
    return req.path === "/api/health";
  },
});

app.use("/api/", globalLimiter);

// ✅ STRICTER RATE LIMITING FOR AUTH ROUTES
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per 15 minutes
  message: "Too many login attempts, please try again later.",
  skipSuccessfulRequests: true,
});

// ✅ STRICTER RATE LIMITING FOR PAYMENTS
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 payment requests per minute
  message: "Too many payment requests, please try again later.",
});

// ✅ LOGGING MIDDLEWARE
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${req.id}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
    );
  });
  next();
});

// ✅ TRUST PROXY (for accurate IP logging behind load balancer)
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1); // Trust first proxy (Render/Heroku)
}

// ==================== ROUTES ====================

// Health check endpoint - BEFORE other routes
app.get("/api/health", (req, res) => {
  res.json({
    status: "✅ Server is running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    requestId: req.id,
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    status: "Server root is working!",
    requestId: req.id,
    endpoints: {
      health: "GET /api/health",
      auth: "POST /api/auth/register, POST /api/auth/login",
      accounts: "GET/POST /api/accounts/*",
      transactions: "GET/POST /api/transactions/*",
      wallet: "GET /api/wallet/*",
      payments: "POST /api/payments/* (DEPOSIT - adds money)",
      paymentTransaction:
        "POST /api/payment-transaction/* (PAYMENT - sends money)",
    },
  });
});

// ✅ API ROUTES WITH RATE LIMITING
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/payments", paymentLimiter, authPayments); // ✅ DEPOSIT ROUTE
app.use("/api/payment-transaction", paymentLimiter, authPaymentTransaction); // ✅ PAYMENT ROUTE
app.use("/api/accounts", authAccount);
app.use("/api/transactions", authTransactions);
app.use("/api/wallet", authWallet);

// ==================== ERROR HANDLING ====================

// ✅ 404 HANDLER - MUST BE AFTER ALL ROUTES
app.use((req, res) => {
  console.log(`[${req.id}] 404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    message: `Endpoint not found: ${req.method} ${req.path}`,
    requestId: req.id,
    availableRoutes: {
      health: "GET /api/health",
      auth: ["POST /api/auth/register", "POST /api/auth/login"],
      accounts: [
        "POST /api/accounts/setup",
        "GET /api/accounts/check",
        "GET /api/accounts/details",
        "PUT /api/accounts/update",
        "PATCH /api/accounts/userAccountStatus",
        "GET /api/accounts/number/:accountNumber",
        "GET /api/accounts/lookup",
      ],
      transactions: [
        "GET /api/transactions/history",
        "GET /api/transactions/:id",
        "POST /api/transactions/deposit",
        "POST /api/transactions/withdraw",
        "POST /api/transactions/transfer",
      ],
      wallet: [
        "GET /api/wallet/balance",
        "GET /api/wallet/stats",
        "GET /api/wallet/recent",
      ],
      deposits: [
        "POST /api/payments/paystack/initialize",
        "POST /api/payments/paystack/verify/:reference",
        "POST /api/payments/paystack/webhook",
        "GET /api/payments/history",
        "GET /api/payments/status/:reference",
        "GET /api/payments/:id",
      ],
      payments: [
        "POST /api/payment-transaction/paystack/initialize",
        "POST /api/payment-transaction/paystack/verify/:reference",
        "GET /api/payment-transaction/history",
        "GET /api/payment-transaction/status/:reference",
        "GET /api/payment-transaction/:id",
      ],
    },
  });
});

// ✅ GLOBAL ERROR HANDLER - MUST BE LAST
app.use((err, req, res, next) => {
  console.error(`[${req.id}] ❌ Server Error:`, err);

  // Handle specific error types
  if (err.status === 413) {
    return res.status(413).json({
      success: false,
      message: "Payload too large. Maximum size is 10MB.",
      requestId: req.id,
    });
  }

  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      details: err.message,
      requestId: req.id,
    });
  }

  if (err.name === "MongoServerError") {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate entry error",
        requestId: req.id,
      });
    }
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    requestId: req.id,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// ==================== SERVER STARTUP ====================

const startServer = async () => {
  try {
    // ✅ Connect to database first
    await connectDB();
    console.log("✅ Database connected");

    // ✅ Start the server
    const server = app.listen(PORT, () => {
      console.log("\n" + "═".repeat(100));
      console.log("✅ SERVER STARTED SUCCESSFULLY");
      console.log("═".repeat(100));
      console.log(`   Port: ${PORT}`);
      console.log(
        `   URL: ${process.env.API_URL || `http://localhost:${PORT}`}`
      );
      console.log(`   Environment: ${process.env.NODE_ENV || "development"}`);
      console.log("\n🔐 SECURITY:");
      console.log("   ✅ Helmet security headers enabled");
      console.log("   ✅ Rate limiting enabled (100 req/15min globally)");
      console.log("   ✅ Auth rate limiting (5 attempts/15min)");
      console.log("   ✅ Payment rate limiting (10 req/1min)");
      console.log("\n⏱️  TIMEOUTS:");
      console.log("   ✅ Global timeout: 120 seconds");
      console.log("   ✅ Email operations (/register, /resend): 120 seconds");
      console.log("\n📧 EMAIL SERVICE:");
      console.log(
        `   ✅ SMTP User: ${process.env.SMTP_USER ? "SET" : "NOT SET"}`
      );
      console.log(
        `   ✅ Sender Email: ${process.env.SENDER_EMAIL ? "SET" : "NOT SET"}`
      );
      console.log(
        `   ✅ Dev Mode: ${
          process.env.SHOW_VERIFICATION_IN_RESPONSE === "true"
            ? "ENABLED"
            : "DISABLED"
        }`
      );
      console.log("\n💰 PAYMENT ROUTES:");
      console.log("   ✅ Deposits: POST /api/payments/paystack/initialize");
      console.log(
        "   ✅ Payments: POST /api/payment-transaction/paystack/initialize"
      );
      console.log("\n" + "═".repeat(100) + "\n");

      // Start cron job after server is ready
      if (process.env.NODE_ENV === "production") {
        job.start();
        console.log("✅ Cron job started");
      }
    });

    // ✅ GRACEFUL SHUTDOWN
    const gracefulShutdown = () => {
      console.log("\n📌 Shutting down gracefully...");
      server.close(() => {
        console.log("✅ Server closed");
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        console.error("❌ Forced shutdown");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// ==================== PROCESS HANDLERS ====================

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Promise Rejection:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

startServer();

export default app;
