// =============== routes/authPaymentTransaction.js ===============
// This route handles PAYMENTS (money going OUT of your account to a recipient)
// Use this ONLY when you have money in your account and want to send it to someone

import express from "express";
import axios from "axios";
import Payment from "../models/Payment.js";
import Transaction from "../models/Transaction.js";
import authMiddleware from "../middleware/auth.js";
import mongoose from "mongoose";
import Account from "../models/Account.js";
import {
  generateReference,
  validateAmount,
  validatePhoneNumber,
} from "../utils/helpers.js";

const router = express.Router();

// ✅ PAYMENT: Initialize Paystack (DEBIT account - Send money)
router.post("/paystack/initialize", authMiddleware, async (req, res) => {
  try {
    const {
      amount,
      email,
      paymentMethod, // "card", "wallet", or "mobile_money"
      recipient, // { name, phone?, network? }
      description,
    } = req.body;

    console.log(`[${req.id}] 💳 Payment initialization:`, {
      amount,
      paymentMethod,
      recipientName: recipient?.name,
    });

    // ✅ VALIDATE AMOUNT
    const validatedAmount = validateAmount(amount);
    if (!validatedAmount.valid) {
      return res.status(400).json({
        success: false,
        message: validatedAmount.error,
      });
    }

    // ✅ GET ACCOUNT
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // ✅ CHECK BALANCE FOR WALLET PAYMENTS
    if (paymentMethod === "wallet") {
      if (account.balance < validatedAmount.amount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient balance. You have ₵${account.balance} but need ₵${validatedAmount.amount}`,
        });
      }
    }

    console.log(`[${req.id}] 📊 Account found:`, account.accountNumber);

    // ✅ BUILD METADATA
    const metadata = {
      userId: req.user.id,
      accountNumber: account.accountNumber,
      paymentMethod,
      description,
      recipientName: recipient?.name || "Payment",
      transactionType: "payment", // ✅ ALWAYS payment
    };

    // ✅ INITIALIZE PAYSTACK
    const paystackResponse = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: email || req.user.email,
        amount: validatedAmount.amount * 100, // Convert to cents
        metadata,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    console.log(
      `[${req.id}] ✅ Paystack initialized:`,
      paystackResponse.data.data.reference
    );

    res.json({
      success: true,
      message: "Payment initialization successful",
      authorizationUrl: paystackResponse.data.data.authorization_url,
      reference: paystackResponse.data.data.reference,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ Paystack init error:`, err.message);
    res.status(400).json({
      success: false,
      message: "Failed to initialize payment",
    });
  }
});

// ✅ PAYMENT: Verify Payment (DEBITS account)
router.post("/paystack/verify/:reference", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reference } = req.params;

    console.log(`[${req.id}] 🔄 Verifying payment:`, reference);

    // ✅ VERIFY WITH PAYSTACK
    const paystackResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    if (paystackResponse.data.data.status !== "success") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
        status: paystackResponse.data.data.status,
      });
    }

    console.log(`[${req.id}] ✅ Paystack verified`);

    const paystackData = paystackResponse.data.data;
    const amount = paystackData.amount / 100;
    const paymentMethod = paystackData.metadata.paymentMethod;

    // ✅ GET ACCOUNT
    const account = await Account.findOne({ userId: req.user.id }).session(
      session
    );
    if (!account) {
      throw new Error("Account not found");
    }

    // ✅ CHECK IDEMPOTENCY
    const existingPayment = await Payment.findOne({
      paymentReference: reference,
    }).session(session);

    if (existingPayment && existingPayment.status === "completed") {
      await session.commitTransaction();
      return res.status(201).json({
        success: true,
        message: "Payment already processed",
        payment: existingPayment,
        newBalance: account.balance,
      });
    }

    // ✅ PAYMENT: DEBIT ACCOUNT
    console.log(`[${req.id}] 💳 Processing PAYMENT - DEBITING account`);

    // Double-check balance
    if (account.balance < amount) {
      throw new Error("Insufficient balance for payment");
    }

    const payment = new Payment({
      accountId: account._id,
      paymentMethod,
      amount,
      currency: account.currency,
      status: "completed",
      recipient: {
        name: paystackData.metadata.recipientName || "Payment",
      },
      paymentReference: reference,
      processedAt: new Date(),
    });

    const balanceBefore = account.balance;
    account.balance -= amount; // ✅ SUBTRACT for payment
    const balanceAfter = account.balance;

    const transaction = new Transaction({
      accountId: account._id,
      type: "payment",
      amount,
      currency: account.currency,
      status: "completed",
      description:
        paystackData.metadata.description ||
        `Payment to ${paystackData.metadata.recipientName}`,
      balanceBefore,
      balanceAfter,
      reference,
      metadata: {
        paymentMethod,
        paystackReference: reference,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      },
      completedAt: new Date(),
    });

    payment.transactionId = transaction._id;

    await account.save({ session });
    await transaction.save({ session });
    await payment.save({ session });

    await session.commitTransaction();

    console.log(`[${req.id}] ✅ Payment completed successfully`);

    return res.status(201).json({
      success: true,
      message: "Payment completed successfully",
      payment,
      newBalance: account.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error(`[${req.id}] ❌ Verification error:`, err.message);
    res.status(400).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

// ✅ GET PAYMENT HISTORY
router.get("/history", authMiddleware, async (req, res) => {
  try {
    console.log(`[${req.id}] 📜 Payment history request`);

    const account = await Account.findOne({ userId: req.user.id });
    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const page = Math.max(parseInt(req.query.page) || 1, 1);

    // Only show payment type transactions
    const query = { accountId: account._id, type: "payment" };

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const count = await Transaction.countDocuments(query);

    console.log(`[${req.id}] ✅ Payment history retrieved`);

    res.json({
      success: true,
      transactions,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ History error:`, err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ GET PAYMENT BY REFERENCE
router.get("/status/:reference", authMiddleware, async (req, res) => {
  try {
    console.log(`[${req.id}] 🔍 Payment status`);

    const account = await Account.findOne({ userId: req.user.id });
    const payment = await Payment.findOne({
      paymentReference: req.params.reference,
      accountId: account._id,
    }).populate("transactionId");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    console.log(`[${req.id}] ✅ Status retrieved`);

    res.json({
      success: true,
      payment,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ Status error:`, err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ GET SINGLE PAYMENT
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    console.log(`[${req.id}] 🔍 Fetching payment`);

    const account = await Account.findOne({ userId: req.user.id });
    const payment = await Payment.findOne({
      _id: req.params.id,
      accountId: account._id,
    }).populate("transactionId");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    console.log(`[${req.id}] ✅ Payment retrieved`);

    res.json({
      success: true,
      payment,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ Error:`, err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

export default router;
