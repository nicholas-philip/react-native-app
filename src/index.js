import express from "express";
import "dotenv/config";
import { connectDB } from "./lib/db.js";
import authRoutes from "./routes/authRoutes.js";
import job from "./lib/cron.js";
import authPayments from "./routes/authPayment.js";
import authAccounts from "./routes/authAccount.js";
import authTransactions from "./routes/authTransactions.js";
import authWallet from "./routes/authWallet.js";

const app = express();
const PORT = process.env.PORT || 3000;

job.start();
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/payments", authPayments);
app.use("/api/accounts", authAccounts);
app.use("/api/transactions", authTransactions);
app.use("/api/wallet", authWallet);

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  connectDB();
});
