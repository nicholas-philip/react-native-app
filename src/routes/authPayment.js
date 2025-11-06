// routes/authPayment.js
import express from "express";
import Payment from "../models/Payment.js";

import Transaction from "../models/Transaction.js";
import authMiddleware from "../middleware/auth.js";
import mongoose from "mongoose";
import Account from "../models/Account.js";

const router = express.Router();
// Initiate payment
router.post("/initiate", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, paymentMethod, recipient } = req.body;

    // Validation
    if (!amount || amount <= 0) {
      throw new Error("Invalid amount");
    }

    if (!paymentMethod) {
      throw new Error("Payment method is required");
    }

    if (!recipient || !recipient.name) {
      throw new Error("Recipient information is required");
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

    const paymentReference =
      "PAY" +
      Date.now() +
      Math.random().toString(36).substr(2, 9).toUpperCase();

    // Create payment record
    const payment = new Payment({
      accountId: account._id,
      paymentMethod,
      amount,
      currency: account.currency,
      status: "processing",
      recipient,
      paymentReference,
    });

    // Deduct from account
    const balanceBefore = account.balance;
    account.balance -= amount;
    const balanceAfter = account.balance;

    // Create transaction record
    const transaction = new Transaction({
      accountId: account._id,
      type: "payment",
      amount,
      currency: account.currency,
      status: "completed",
      description: `Payment to ${recipient.name}`,
      balanceBefore,
      balanceAfter,
      reference: paymentReference,
      completedAt: new Date(),
    });

    payment.transactionId = transaction._id;

    await account.save({ session });
    await transaction.save({ session });
    await payment.save({ session });

    // Simulate payment processing (in real app, integrate with payment gateway)
    setTimeout(async () => {
      try {
        const updatePayment = await Payment.findOne({ paymentReference });
        if (updatePayment) {
          updatePayment.status = "completed";
          updatePayment.processedAt = new Date();
          await updatePayment.save();
        }
      } catch (error) {
        console.error("Payment update error:", error);
      }
    }, 2000);

    await session.commitTransaction();
    res.status(201).json({
      payment,
      newBalance: account.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
});

// Get payment history with pagination
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    const { page = 1, limit = 20, status } = req.query;
    const query = { accountId: account._id };

    if (status) query.status = status;

    const payments = await Payment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Payment.countDocuments(query);

    res.json({
      payments,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      total: count,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get payment status by reference
router.get("/status/:reference", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    const payment = await Payment.findOne({
      paymentReference: req.params.reference,
      accountId: account._id,
    }).populate("transactionId");

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single payment by ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    const payment = await Payment.findOne({
      _id: req.params.id,
      accountId: account._id,
    }).populate("transactionId");

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Cancel pending payment
router.patch("/:id/cancel", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const account = await Account.findOne({ userId: req.user.id }).session(
      session
    );
    const payment = await Payment.findOne({
      _id: req.params.id,
      accountId: account._id,
    }).session(session);

    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "pending" && payment.status !== "processing") {
      throw new Error("Cannot cancel this payment");
    }

    // Refund amount back to account
    account.balance += payment.amount;
    payment.status = "failed";

    // Update transaction status
    const transaction = await Transaction.findById(
      payment.transactionId
    ).session(session);
    if (transaction) {
      transaction.status = "cancelled";
      await transaction.save({ session });
    }

    await account.save({ session });
    await payment.save({ session });

    await session.commitTransaction();
    res.json({
      message: "Payment cancelled successfully",
      payment,
      refundedAmount: payment.amount,
      newBalance: account.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ message: err.message });
  } finally {
    session.endSession();
  }
});

export default router;
