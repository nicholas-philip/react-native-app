// =============== routes/authTransactions.js (CLEAN FIX) ===============
import express from "express";
import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import Account from "../models/Account.js";
import authMiddleware from "../middleware/auth.js";
import { generateReference, validateAmount } from "../utils/helpers.js";

const router = express.Router();

// ✅ Get transaction history with pagination
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
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
      success: true,
      transactions,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      total: count,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ Get single transaction by ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      accountId: account._id,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    res.json({
      success: true,
      transaction,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ DEPOSIT money (Direct - no Paystack)
router.post("/deposit", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, description } = req.body;

    const validatedAmount = validateAmount(amount);
    if (!validatedAmount.valid) {
      throw new Error(validatedAmount.error);
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
    account.balance += validatedAmount.amount;
    const balanceAfter = account.balance;

    const transaction = new Transaction({
      accountId: account._id,
      type: "deposit",
      amount: validatedAmount.amount,
      currency: account.currency,
      status: "completed",
      description: description || "Deposit",
      balanceBefore,
      balanceAfter,
      reference: generateReference("deposit"),
      completedAt: new Date(),
    });

    await account.save({ session });
    await transaction.save({ session });

    await session.commitTransaction();
    res.status(201).json({
      success: true,
      message: "Deposit completed successfully",
      transaction,
      newBalance: account.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

// ✅ WITHDRAW money
router.post("/withdraw", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, description } = req.body;

    const validatedAmount = validateAmount(amount);
    if (!validatedAmount.valid) {
      throw new Error(validatedAmount.error);
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

    if (account.balance < validatedAmount.amount) {
      throw new Error("Insufficient funds");
    }

    const balanceBefore = account.balance;
    account.balance -= validatedAmount.amount;
    const balanceAfter = account.balance;

    const transaction = new Transaction({
      accountId: account._id,
      type: "withdrawal",
      amount: validatedAmount.amount,
      currency: account.currency,
      status: "completed",
      description: description || "Withdrawal",
      balanceBefore,
      balanceAfter,
      reference: generateReference("withdrawal"),
      completedAt: new Date(),
    });

    await account.save({ session });
    await transaction.save({ session });

    await session.commitTransaction();
    res.status(201).json({
      success: true,
      message: "Withdrawal completed successfully",
      transaction,
      newBalance: account.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

// ✅ TRANSFER money - MOBILE MONEY ONLY (Paystack verified)
// For bank transfers, use /payments/paystack/initialize + /payments/paystack/verify
router.post("/transfer", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reference, amount, description, phoneNumber, network } = req.body;

    console.log(`[${req.id}] 📱 Processing mobile money transfer`);

    const validatedAmount = validateAmount(amount);
    if (!validatedAmount.valid) {
      throw new Error(validatedAmount.error);
    }

    if (!reference) {
      throw new Error("Paystack reference is required");
    }

    if (!phoneNumber || !network) {
      throw new Error("Phone number and network are required for transfers");
    }

    if (!["MTN", "VODAFONE", "TIGO"].includes(network)) {
      throw new Error("Valid network is required (MTN, VODAFONE, or TIGO)");
    }

    // Get sender account
    const senderAccount = await Account.findOne({
      userId: req.user.id,
    }).session(session);

    if (!senderAccount) {
      throw new Error("Sender account not found");
    }

    if (senderAccount.status !== "active") {
      throw new Error("Sender account is not active");
    }

    // Check balance
    if (senderAccount.balance < validatedAmount.amount) {
      throw new Error("Insufficient funds");
    }

    // Check for existing transfer (idempotency)
    const existingTransfer = await Transaction.findOne({
      reference,
      type: "transfer_out",
    }).session(session);

    if (existingTransfer) {
      await session.commitTransaction();
      return res.status(201).json({
        success: true,
        message: "Transfer already completed",
        transaction: existingTransfer,
        newBalance: senderAccount.balance,
      });
    }

    // Debit sender (money goes to mobile money provider)
    const senderBalanceBefore = senderAccount.balance;
    senderAccount.balance -= validatedAmount.amount;
    const senderBalanceAfter = senderAccount.balance;

    console.log(
      `[${req.id}] 💸 Sender balance: ${senderBalanceBefore} → ${senderBalanceAfter}`
    );

    const senderTransaction = new Transaction({
      accountId: senderAccount._id,
      type: "transfer_out",
      amount: validatedAmount.amount,
      currency: senderAccount.currency,
      status: "completed",
      description:
        description || `Mobile money transfer to ${phoneNumber} (${network})`,
      balanceBefore: senderBalanceBefore,
      balanceAfter: senderBalanceAfter,
      reference,
      metadata: {
        transferType: "mobile_money",
        phoneNumber,
        network,
        paystackReference: reference,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      },
      completedAt: new Date(),
    });

    await senderAccount.save({ session });
    await senderTransaction.save({ session });

    await session.commitTransaction();

    console.log(`[${req.id}] ✅ Mobile money transfer completed`);

    res.status(201).json({
      success: true,
      message: "Transfer completed successfully",
      transaction: senderTransaction,
      newBalance: senderAccount.balance,
      transferType: "mobile_money",
      recipient: {
        phone: phoneNumber,
        network,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    console.error(`[${req.id}] ❌ Transfer error:`, err.message);
    res.status(400).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

export default router;
