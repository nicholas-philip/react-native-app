// routes/transactions.js
import express from "express";
import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import Account from "../models/Account.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

// Get transaction history with pagination
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    const { page = 1, limit = 20, type, status } = req.query;
    const query = { accountId: account._id };

    if (type) query.type = type;
    if (status) query.status = status;

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Transaction.countDocuments(query);

    res.json({
      transactions,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      total: count,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single transaction by ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      accountId: account._id,
    });

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    res.json(transaction);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Deposit money
router.post("/deposit", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      throw new Error("Invalid amount");
    }

    const account = await Account.findOne({ userId: req.user.id }).session(
      session
    );
    if (!account) {
      throw new Error("Account not found");
    }

    if (account.status !== "active") {
      throw new Error("Account is not active");
    }

    const balanceBefore = account.balance;
    account.balance += amount;
    const balanceAfter = account.balance;

    const transaction = new Transaction({
      accountId: account._id,
      type: "deposit",
      amount,
      currency: account.currency,
      status: "completed",
      description: description || "Deposit",
      balanceBefore,
      balanceAfter,
      reference:
        "DEP" +
        Date.now() +
        Math.random().toString(36).substr(2, 9).toUpperCase(),
      completedAt: new Date(),
    });

    await account.save({ session });
    await transaction.save({ session });

    await session.commitTransaction();
    res.status(201).json({
      transaction,
      newBalance: account.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
});

// Withdraw money
router.post("/withdraw", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      throw new Error("Invalid amount");
    }

    const account = await Account.findOne({ userId: req.user.id }).session(
      session
    );
    if (!account) {
      throw new Error("Account not found");
    }

    if (account.status !== "active") {
      throw new Error("Account is not active");
    }

    if (account.balance < amount) {
      throw new Error("Insufficient funds");
    }

    const balanceBefore = account.balance;
    account.balance -= amount;
    const balanceAfter = account.balance;

    const transaction = new Transaction({
      accountId: account._id,
      type: "withdrawal",
      amount,
      currency: account.currency,
      status: "completed",
      description: description || "Withdrawal",
      balanceBefore,
      balanceAfter,
      reference:
        "WDR" +
        Date.now() +
        Math.random().toString(36).substr(2, 9).toUpperCase(),
      completedAt: new Date(),
    });

    await account.save({ session });
    await transaction.save({ session });

    await session.commitTransaction();
    res.status(201).json({
      transaction,
      newBalance: account.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
});

// Transfer money to another account
router.post("/transfer", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { recipientAccountNumber, amount, description } = req.body;

    if (!amount || amount <= 0) {
      throw new Error("Invalid amount");
    }

    if (!recipientAccountNumber) {
      throw new Error("Recipient account number is required");
    }

    const senderAccount = await Account.findOne({
      userId: req.user.id,
    }).session(session);
    if (!senderAccount) {
      throw new Error("Sender account not found");
    }

    if (senderAccount.status !== "active") {
      throw new Error("Sender account is not active");
    }

    const recipientAccount = await Account.findOne({
      accountNumber: recipientAccountNumber,
    }).session(session);

    if (!recipientAccount) {
      throw new Error("Recipient account not found");
    }

    if (recipientAccount.status !== "active") {
      throw new Error("Recipient account is not active");
    }

    if (senderAccount.accountNumber === recipientAccountNumber) {
      throw new Error("Cannot transfer to same account");
    }

    if (senderAccount.balance < amount) {
      throw new Error("Insufficient funds");
    }

    const transferRef =
      "TRF" +
      Date.now() +
      Math.random().toString(36).substr(2, 9).toUpperCase();

    // Debit sender
    const senderBalanceBefore = senderAccount.balance;
    senderAccount.balance -= amount;
    const senderBalanceAfter = senderAccount.balance;

    const senderTransaction = new Transaction({
      accountId: senderAccount._id,
      type: "transfer_out",
      amount,
      currency: senderAccount.currency,
      status: "completed",
      description: description || `Transfer to ${recipientAccountNumber}`,
      recipientAccountId: recipientAccount._id,
      recipientAccountNumber,
      balanceBefore: senderBalanceBefore,
      balanceAfter: senderBalanceAfter,
      reference: transferRef,
      completedAt: new Date(),
    });

    // Credit recipient
    const recipientBalanceBefore = recipientAccount.balance;
    recipientAccount.balance += amount;
    const recipientBalanceAfter = recipientAccount.balance;

    const recipientTransaction = new Transaction({
      accountId: recipientAccount._id,
      type: "transfer_in",
      amount,
      currency: recipientAccount.currency,
      status: "completed",
      description:
        description || `Transfer from ${senderAccount.accountNumber}`,
      balanceBefore: recipientBalanceBefore,
      balanceAfter: recipientBalanceAfter,
      reference: transferRef,
      completedAt: new Date(),
    });

    await senderAccount.save({ session });
    await recipientAccount.save({ session });
    await senderTransaction.save({ session });
    await recipientTransaction.save({ session });

    await session.commitTransaction();
    res.status(201).json({
      transaction: senderTransaction,
      newBalance: senderAccount.balance,
      recipient: {
        accountNumber: recipientAccount.accountNumber,
        received: amount,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
});

export default router;
