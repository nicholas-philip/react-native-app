import express from "express";

import Transaction from "../models/Transaction.js";
import Account from "../models/Account.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

// Get wallet balance
router.get("/balance", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    res.json({
      balance: account.balance,
      currency: account.currency,
      accountNumber: account.accountNumber,
      accountType: account.accountType,
      status: account.status,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get wallet statistics
router.get("/stats", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      return res.status(404).json({ message: "Account not found" });
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
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
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
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
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
          $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } },
        },
      ]),
      Transaction.countDocuments({
        accountId: account._id,
        createdAt: { $gte: thirtyDaysAgo },
      }),
    ]);

    res.json({
      currentBalance: account.balance,
      currency: account.currency,
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
    res.status(500).json({ message: err.message });
  }
});

// Get recent transactions (last 10)
router.get("/recent", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    const transactions = await Transaction.find({ accountId: account._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("type amount currency status description createdAt reference");

    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
