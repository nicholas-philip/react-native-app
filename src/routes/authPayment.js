// =============== routes/authPayment.js (COMPLETE FIX) ===============
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
import crypto from "crypto";

const router = express.Router();

// ✅ VERIFY Paystack webhook signature
const verifyPaystackSignature = (req) => {
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest("hex");

  return hash === req.headers["x-paystack-signature"];
};

// ✅ PAYSTACK: Initialize Payment/Transfer
router.post("/paystack/initialize", authMiddleware, async (req, res) => {
  try {
    const {
      amount,
      email,
      phoneNumber,
      network,
      paymentMethod,
      recipientAccountNumber,
      recipient,
      description,
    } = req.body;

    console.log(`[${req.id}] 📱 Paystack initialization:`, {
      amount,
      paymentMethod,
      network,
    });

    // ✅ VALIDATE AMOUNT
    const validatedAmount = validateAmount(amount);
    if (!validatedAmount.valid) {
      return res.status(400).json({
        success: false,
        message: validatedAmount.error,
      });
    }

    // ✅ VALIDATE MOBILE MONEY
    if (paymentMethod === "mobile_money") {
      if (!network || !["MTN", "VODAFONE", "TIGO"].includes(network)) {
        return res.status(400).json({
          success: false,
          message: "Invalid network. Must be MTN, VODAFONE, or TIGO",
        });
      }

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required for mobile money",
        });
      }

      const phoneValidation = validatePhoneNumber(phoneNumber);
      if (!phoneValidation.valid) {
        return res.status(400).json({
          success: false,
          message: phoneValidation.error,
        });
      }
    }

    // ✅ VALIDATE BANK TRANSFER
    if (paymentMethod === "transfer" && !recipientAccountNumber) {
      return res.status(400).json({
        success: false,
        message: "Recipient account number is required for transfers",
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

    console.log(`[${req.id}] 📊 Account found:`, account.accountNumber);

    // ✅ BUILD METADATA
    const metadata = {
      userId: req.user.id,
      accountNumber: account.accountNumber,
      paymentMethod,
      description,
    };

    if (paymentMethod === "mobile_money") {
      metadata.network = network;
      metadata.phoneNumber = phoneNumber;
    }

    if (paymentMethod === "transfer") {
      metadata.recipientAccountNumber = recipientAccountNumber;
    }

    if (recipient) {
      metadata.recipientName = recipient.name;
    }

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

// ✅ PAYSTACK: Verify Payment
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

    // ✅ CARD/WALLET PAYMENT (Debit)
    if (paymentMethod === "card" || paymentMethod === "wallet") {
      console.log(`[${req.id}] 💳 Processing card/wallet payment`);

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
      account.balance -= amount;
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
          method: paymentMethod,
          paystackReference: paystackData.reference,
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

      console.log(`[${req.id}] ✅ Payment completed`);

      return res.status(201).json({
        success: true,
        message: "Payment completed successfully",
        payment,
        newBalance: account.balance,
      });
    }

    // ✅ MOBILE MONEY DEPOSIT (Credit)
    if (paymentMethod === "mobile_money") {
      console.log(`[${req.id}] 📱 Processing mobile money deposit`);

      const payment = new Payment({
        accountId: account._id,
        paymentMethod: "mobile_money",
        amount,
        currency: account.currency,
        status: "completed",
        recipient: {
          name: "Mobile Money Deposit",
          phone: paystackData.metadata.phoneNumber,
          network: paystackData.metadata.network,
        },
        paymentReference: reference,
        processedAt: new Date(),
      });

      const balanceBefore = account.balance;
      account.balance += amount;
      const balanceAfter = account.balance;

      const transaction = new Transaction({
        accountId: account._id,
        type: "deposit",
        amount,
        currency: account.currency,
        status: "completed",
        description: `Mobile money deposit via ${paystackData.metadata.network}`,
        balanceBefore,
        balanceAfter,
        reference,
        metadata: {
          paystackReference: paystackData.reference,
          network: paystackData.metadata.network,
          phoneNumber: paystackData.metadata.phoneNumber,
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

      console.log(`[${req.id}] ✅ Deposit completed`);

      return res.status(201).json({
        success: true,
        message: "Deposit completed successfully",
        payment,
        newBalance: account.balance,
      });
    }

    throw new Error("Invalid payment method");
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

// ✅ WEBHOOK
router.post("/paystack/webhook", express.json(), (req, res) => {
  try {
    if (!verifyPaystackSignature(req)) {
      console.error("[WEBHOOK] ❌ Invalid signature");
      return res.status(401).json({
        success: false,
        message: "Invalid signature",
      });
    }

    const event = req.body;
    console.log("[WEBHOOK] ✅ Event received:", event.event);

    res.json({ success: true });
  } catch (err) {
    console.error("[WEBHOOK] ❌ Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Webhook processing failed",
    });
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
    const { status } = req.query;

    const query = { accountId: account._id };
    if (status) query.status = status;

    const payments = await Payment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const count = await Payment.countDocuments(query);

    console.log(`[${req.id}] ✅ History retrieved`);

    res.json({
      success: true,
      payments,
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
