// =============== routes/authTransactions.js (PAYSTACK TRANSFER) ===============
import express from "express";
import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import Account from "../models/Account.js";
import Payment from "../models/Payment.js";
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

// ✅ TRANSFER money to another account (PAYSTACK VERIFIED)
router.post("/transfer", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reference, recipientAccountNumber, amount, description } = req.body;

    console.log(`[${req.id}] 🔄 Processing transfer with Paystack reference`);

    const validatedAmount = validateAmount(amount);
    if (!validatedAmount.valid) {
      throw new Error(validatedAmount.error);
    }

    if (!recipientAccountNumber) {
      throw new Error("Recipient account number is required");
    }

    if (!reference) {
      throw new Error("Paystack reference is required");
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

    const transferRef = reference || generateReference("transfer");

    // ✅ Debit sender
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
      description: description || `Transfer to ${recipientAccountNumber}`,
      balanceBefore: senderBalanceBefore,
      balanceAfter: senderBalanceAfter,
      reference: transferRef,
      metadata: {
        recipientAccountNumber,
        paystackReference: reference,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      },
      completedAt: new Date(),
    });

    // ✅ Create payment record for sender
    const senderPayment = new Payment({
      accountId: senderAccount._id,
      paymentMethod: "transfer",
      amount: validatedAmount.amount,
      currency: senderAccount.currency,
      status: "completed",
      recipient: {
        accountNumber: recipientAccountNumber,
      },
      paymentReference: transferRef,
      transactionId: senderTransaction._id,
      processedAt: new Date(),
    });

    // ✅ Credit recipient
    const recipientBalanceBefore = recipientAccount.balance;
    recipientAccount.balance += validatedAmount.amount;
    const recipientBalanceAfter = recipientAccount.balance;

    console.log(
      `[${req.id}] 💳 Recipient balance: ${recipientBalanceBefore} → ${recipientBalanceAfter}`
    );

    const recipientTransaction = new Transaction({
      accountId: recipientAccount._id,
      type: "transfer_in",
      amount: validatedAmount.amount,
      currency: recipientAccount.currency,
      status: "completed",
      description:
        description || `Transfer from ${senderAccount.accountNumber}`,
      balanceBefore: recipientBalanceBefore,
      balanceAfter: recipientBalanceAfter,
      reference: transferRef,
      metadata: {
        senderAccountNumber: senderAccount.accountNumber,
        paystackReference: reference,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      },
      completedAt: new Date(),
    });

    // ✅ Create payment record for recipient
    const recipientPayment = new Payment({
      accountId: recipientAccount._id,
      paymentMethod: "transfer",
      amount: validatedAmount.amount,
      currency: recipientAccount.currency,
      status: "completed",
      recipient: {
        accountNumber: senderAccount.accountNumber,
      },
      paymentReference: transferRef,
      transactionId: recipientTransaction._id,
      processedAt: new Date(),
    });

    await senderAccount.save({ session });
    await recipientAccount.save({ session });
    await senderTransaction.save({ session });
    await recipientTransaction.save({ session });
    await senderPayment.save({ session });
    await recipientPayment.save({ session });

    await session.commitTransaction();

    console.log(`[${req.id}] ✅ Transfer completed successfully`);

    res.status(201).json({
      success: true,
      message: "Transfer completed successfully",
      transaction: senderTransaction,
      newBalance: senderAccount.balance,
      recipient: {
        accountNumber: recipientAccount.accountNumber,
        received: validatedAmount.amount,
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
