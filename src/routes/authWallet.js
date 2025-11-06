import express from "express";
import Transaction from "../models/Transaction.js";
import Account from "../models/Account.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

// Get wallet balance
router.get("/balance", authMiddleware, async (req, res) => {
  try {
    console.log("📊 Fetching balance for user:", req.user.id);

    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      console.log("❌ Account not found for user:", req.user.id);
      return res.status(404).json({
        success: false,
        message: "Account not found. Please complete account setup.",
      });
    }

    console.log("✅ Balance fetched successfully:", account.balance);

    res.json({
      success: true,
      balance: account.balance || 0,
      currency: account.currency || "USD",
      accountNumber: account.accountNumber,
      accountType: account.accountType,
      status: account.status,
    });
  } catch (err) {
    console.error("❌ Balance fetch error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// Get wallet statistics
router.get("/stats", authMiddleware, async (req, res) => {
  try {
    console.log("📈 Fetching stats for user:", req.user.id);

    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      console.log("❌ Account not found for user:", req.user.id);
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalDeposits,
      totalWithdrawals,
      totalTransfersOut,
      recentTransactions,
    ] = await Promise.all([
      Transaction.aggregate([
        {
          $match: {
            accountId: account._id,
            type: "deposit",
            status: "completed",
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      Transaction.aggregate([
        {
          $match: {
            accountId: account._id,
            type: "withdrawal",
            status: "completed",
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      Transaction.aggregate([
        {
          $match: {
            accountId: account._id,
            type: "transfer_out",
            status: "completed",
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      Transaction.countDocuments({
        accountId: account._id,
        createdAt: { $gte: thirtyDaysAgo },
      }),
    ]);

    console.log("✅ Stats fetched successfully");

    res.json({
      success: true,
      currentBalance: account.balance || 0,
      currency: account.currency || "USD",
      last30Days: {
        deposits: {
          total: totalDeposits[0]?.total || 0,
          count: totalDeposits[0]?.count || 0,
        },
        withdrawals: {
          total: totalWithdrawals[0]?.total || 0,
          count: totalWithdrawals[0]?.count || 0,
        },
        transfers: {
          total: totalTransfersOut[0]?.total || 0,
          count: totalTransfersOut[0]?.count || 0,
        },
        totalTransactions: recentTransactions,
      },
    });
  } catch (err) {
    console.error("❌ Stats fetch error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// Get recent transactions (last 10)
router.get("/recent", authMiddleware, async (req, res) => {
  try {
    console.log("📜 Fetching recent transactions for user:", req.user.id);

    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      console.log("❌ Account not found for user:", req.user.id);
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    const transactions = await Transaction.find({ accountId: account._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("type amount currency status description createdAt reference");

    console.log(`✅ Found ${transactions.length} recent transactions`);

    res.json({
      success: true,
      transactions: transactions || [],
    });
  } catch (err) {
    console.error("❌ Recent transactions fetch error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

export default router;
