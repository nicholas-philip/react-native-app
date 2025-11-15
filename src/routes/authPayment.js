// =============== routes/authPayment.js (PAYSTACK UNIFIED) ===============
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

// ✅ PAYSTACK: Initialize Payment/Transfer (Card, Wallet, Mobile Money)
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

    console.log(`[${req.id}] 📱 Paystack initialization request:`, {
      amount,
      paymentMethod,
      network,
    });

    // ✅ INPUT VALIDATION
    const validatedAmount = validateAmount(amount);
    if (!validatedAmount.valid) {
      return res.status(400).json({
        success: false,
        message: validatedAmount.error,
      });
    }

    // Only validate network for mobile money payments
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

    const account = await Account.findOne({ userId: req.user.id });
    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    console.log(`[${req.id}] 📊 Account found:`, account.accountNumber);

    const metadata = {
      userId: req.user.id,
      accountNumber: account.accountNumber,
      paymentMethod,
      description,
    };

    // Only add mobile money specific metadata
    if (paymentMethod === "mobile_money") {
      metadata.network = network;
      metadata.phoneNumber = phoneNumber; // ✅ Plain text - NO encryption
    }

    // Only add transfer specific metadata
    if (paymentMethod === "transfer" || recipientAccountNumber) {
      metadata.recipientAccountNumber = recipientAccountNumber;
    }

    if (recipient) {
      metadata.recipientName = recipient.name;
    }

    // Call Paystack to initialize transaction
    const paystackResponse = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: email || req.user.email,
        amount: validatedAmount.amount * 100, // Paystack uses cents
        metadata,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    console.log(
      `[${req.id}] ✅ Paystack transaction initialized:`,
      paystackResponse.data.data.reference
    );

    res.json({
      success: true,
      message: "Payment initialization successful",
      authorizationUrl: paystackResponse.data.data.authorization_url,
      reference: paystackResponse.data.data.reference,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ Paystack initialization error:`, err.message);
    res.status(400).json({
      success: false,
      message: "Failed to initialize payment",
    });
  }
});

// ✅ PAYSTACK: Verify & Complete Payment/Transfer
router.post("/paystack/verify/:reference", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reference } = req.params;

    console.log(`[${req.id}] 🔄 Verifying Paystack payment:`, reference);

    // Verify with Paystack API
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

    console.log(`[${req.id}] ✅ Paystack payment verified`);

    const paystackData = paystackResponse.data.data;
    const amount = paystackData.amount / 100; // Convert from cents
    const paymentMethod = paystackData.metadata.paymentMethod;

    const account = await Account.findOne({ userId: req.user.id }).session(
      session
    );
    if (!account) {
      throw new Error("Account not found");
    }

    // Check if payment already processed (idempotency)
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

    // ✅ HANDLE PAYMENT TO RECIPIENT (Bill Payment)
    if (paymentMethod === "card" || paymentMethod === "wallet") {
      console.log(`[${req.id}] 💰 Processing bill payment`);

      const payment = new Payment({
        accountId: account._id,
        paymentMethod,
        amount,
        currency: account.currency,
        status: "completed",
        recipient: {
          name: paystackData.metadata.recipientName,
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

      console.log(`[${req.id}] ✅ Bill payment completed successfully`);

      return res.status(201).json({
        success: true,
        message: "Payment completed successfully",
        payment,
        newBalance: account.balance,
      });
    }

    // ✅ HANDLE MOBILE MONEY DEPOSIT
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

      console.log(`[${req.id}] ✅ Mobile money deposit completed successfully`);

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
    console.error(`[${req.id}] ❌ Paystack verification error:`, err.message);
    res.status(400).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

// ✅ PAYSTACK: Handle payment.success webhook
router.post("/paystack/webhook", express.json(), (req, res) => {
  try {
    // ✅ VERIFY WEBHOOK SIGNATURE
    if (!verifyPaystackSignature(req)) {
      console.error("[WEBHOOK] ❌ Invalid Paystack signature");
      return res.status(401).json({
        success: false,
        message: "Invalid signature",
      });
    }

    const event = req.body;
    console.log("[WEBHOOK] ✅ Paystack webhook received:", event.event);

    if (event.event === "charge.success") {
      console.log("[WEBHOOK] 💰 Payment successful:", event.data.reference);
      // Additional webhook processing can be added here
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[WEBHOOK] ❌ Webhook error:", err.message);
    res.status(500).json({
      success: false,
      message: "Webhook processing failed",
    });
  }
});

// ✅ Get payment history with pagination
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

    console.log(`[${req.id}] ✅ Payment history retrieved`);

    res.json({
      success: true,
      payments,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ History fetch error:`, err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ Get payment status by reference
router.get("/status/:reference", authMiddleware, async (req, res) => {
  try {
    console.log(`[${req.id}] 🔍 Checking payment status`);

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

    console.log(`[${req.id}] ✅ Payment status retrieved`);

    res.json({
      success: true,
      payment,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ Status fetch error:`, err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ Get single payment by ID
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
    console.error(`[${req.id}] ❌ Payment fetch error:`, err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

export default router;
