// =============== routes/authPayment.js (COMPLETE - NO ENCRYPTION) ===============
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

// ✅ UNIFIED: Initiate Payment (Wallet, Card, Transfer only - Deposits handled separately)
router.post("/initiate", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      amount,
      paymentMethod, // "wallet", "card", "transfer"
      phoneNumber,
      network, // "MTN", "VODAFONE", "TIGO"
      recipient, // For transfers to other users
      description,
      idempotencyKey, // For idempotency
    } = req.body;

    console.log(`[${req.id}] 💳 Payment initiate request:`, {
      amount,
      paymentMethod,
      recipient: recipient?.name,
    });

    // ✅ INPUT VALIDATION
    if (!amount) {
      throw new Error("Amount is required");
    }

    const validatedAmount = validateAmount(amount);
    if (!validatedAmount.valid) {
      throw new Error(validatedAmount.error);
    }

    if (!paymentMethod) {
      throw new Error("Payment method is required");
    }

    if (!["wallet", "card", "transfer"].includes(paymentMethod)) {
      throw new Error("Invalid payment method");
    }

    // ✅ IDEMPOTENCY CHECK
    if (idempotencyKey) {
      const existingPayment = await Payment.findOne({ idempotencyKey }).session(
        session
      );
      if (existingPayment) {
        console.log(
          `[${req.id}] ℹ️ Idempotent request - returning existing payment`
        );
        await session.commitTransaction();
        return res.status(201).json({
          success: true,
          message: "Idempotent request - returning existing payment",
          payment: existingPayment,
        });
      }
    }

    const account = await Account.findOne({ userId: req.user.id }).session(
      session
    );
    if (!account) {
      throw new Error("Account not found");
    }

    console.log(`[${req.id}] 📊 Account status:`, account.status);

    if (account.status !== "active") {
      throw new Error(`Account is ${account.status}. Cannot process payments.`);
    }

    // Check balance for payments
    if (account.balance < validatedAmount.amount) {
      throw new Error(
        `Insufficient funds. Balance: ₵${account.balance}, Required: ₵${validatedAmount.amount}`
      );
    }

    const paymentReference = generateReference("payment");
    console.log(`[${req.id}] 📝 Generated reference:`, paymentReference);

    // ✅ WALLET OR CARD PAYMENT (Pay bills)
    if (paymentMethod === "wallet" || paymentMethod === "card") {
      console.log(`[${req.id}] 💰 Processing ${paymentMethod} payment`);

      if (!recipient || !recipient.name) {
        throw new Error("Recipient name is required");
      }

      // Validate description
      if (description && description.length > 500) {
        throw new Error("Description too long (max 500 characters)");
      }

      // ✅ Debit sender
      const balanceBefore = account.balance;
      account.balance -= validatedAmount.amount;
      const balanceAfter = account.balance;

      console.log(
        `[${req.id}] 💸 Balance change: ${balanceBefore} → ${balanceAfter}`
      );

      const payment = new Payment({
        accountId: account._id,
        paymentMethod: paymentMethod,
        amount: validatedAmount.amount,
        currency: account.currency,
        status: "completed",
        recipient: {
          name: recipient.name,
        },
        paymentReference,
        idempotencyKey: idempotencyKey || null,
        processedAt: new Date(),
      });

      const transaction = new Transaction({
        accountId: account._id,
        type: "payment",
        amount: validatedAmount.amount,
        currency: account.currency,
        status: "completed",
        description: description || `Payment to ${recipient.name}`,
        balanceBefore,
        balanceAfter,
        reference: paymentReference,
        metadata: {
          method: paymentMethod,
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
    }

    // ✅ TRANSFER TO ANOTHER USER
    if (paymentMethod === "transfer") {
      console.log(`[${req.id}] 🔄 Processing transfer`);

      if (!recipient || !recipient.accountNumber) {
        throw new Error("Recipient account number is required");
      }

      const recipientAccount = await Account.findOne({
        accountNumber: recipient.accountNumber,
      }).session(session);

      if (!recipientAccount) {
        throw new Error("Recipient account not found");
      }

      console.log(
        `[${req.id}] 📋 Recipient account:`,
        recipientAccount.accountNumber
      );

      if (recipientAccount.status !== "active") {
        throw new Error("Recipient account is not active");
      }

      if (account.accountNumber === recipient.accountNumber) {
        throw new Error("Cannot transfer to same account");
      }

      // ✅ Debit sender
      const senderBalanceBefore = account.balance;
      account.balance -= validatedAmount.amount;
      const senderBalanceAfter = account.balance;

      console.log(
        `[${req.id}] 💸 Sender balance: ${senderBalanceBefore} → ${senderBalanceAfter}`
      );

      const senderPayment = new Payment({
        accountId: account._id,
        paymentMethod: "transfer",
        amount: validatedAmount.amount,
        currency: account.currency,
        status: "completed",
        recipient: {
          name: recipient.name || "Transfer",
          accountNumber: recipient.accountNumber,
        },
        paymentReference,
        idempotencyKey: idempotencyKey || null,
      });

      const senderTransaction = new Transaction({
        accountId: account._id,
        type: "transfer_out",
        amount: validatedAmount.amount,
        currency: account.currency,
        status: "completed",
        description: description || `Transfer to ${recipient.accountNumber}`,
        balanceBefore: senderBalanceBefore,
        balanceAfter: senderBalanceAfter,
        reference: paymentReference,
        metadata: {
          recipientAccountNumber: recipient.accountNumber,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        },
        completedAt: new Date(),
      });

      senderPayment.transactionId = senderTransaction._id;

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
        description: description || `Transfer from ${account.accountNumber}`,
        balanceBefore: recipientBalanceBefore,
        balanceAfter: recipientBalanceAfter,
        reference: paymentReference,
        metadata: {
          senderAccountNumber: account.accountNumber,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        },
        completedAt: new Date(),
      });

      await account.save({ session });
      await recipientAccount.save({ session });
      await senderTransaction.save({ session });
      await recipientTransaction.save({ session });
      await senderPayment.save({ session });

      await session.commitTransaction();

      console.log(`[${req.id}] ✅ Transfer completed successfully`);

      return res.status(201).json({
        success: true,
        message: "Transfer completed successfully",
        payment: senderPayment,
        newBalance: account.balance,
        recipient: {
          accountNumber: recipientAccount.accountNumber,
          received: validatedAmount.amount,
        },
      });
    }

    throw new Error("Invalid payment method");
  } catch (err) {
    await session.abortTransaction();
    console.error(`[${req.id}] ❌ Payment error:`, err.message);
    res.status(400).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

// ✅ PAYSTACK: Initialize Mobile Money Payment
router.post("/paystack/initialize", authMiddleware, async (req, res) => {
  try {
    const { amount, email, phoneNumber, network } = req.body;

    console.log(`[${req.id}] 📱 Paystack initialization request:`, {
      amount,
      network,
      phoneNumber: phoneNumber?.substring(0, 6) + "****",
    });

    // ✅ INPUT VALIDATION
    const validatedAmount = validateAmount(amount);
    if (!validatedAmount.valid) {
      return res.status(400).json({
        success: false,
        message: validatedAmount.error,
      });
    }

    if (!["MTN", "VODAFONE", "TIGO"].includes(network)) {
      return res.status(400).json({
        success: false,
        message: "Invalid network. Must be MTN, VODAFONE, or TIGO",
      });
    }

    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
      return res.status(400).json({
        success: false,
        message: phoneValidation.error,
      });
    }

    const account = await Account.findOne({ userId: req.user.id });
    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    console.log(`[${req.id}] 📊 Account found:`, account.accountNumber);

    // Call Paystack to initialize transaction
    const paystackResponse = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: email || req.user.email,
        amount: validatedAmount.amount * 100, // Paystack uses cents
        metadata: {
          userId: req.user.id,
          accountNumber: account.accountNumber,
          network,
          phoneNumber: phoneValidation.phoneNumber, // ✅ Plain text - NO encryption
        },
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

// ✅ PAYSTACK: Verify & Complete Deposit
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

    const account = await Account.findOne({ userId: req.user.id }).session(
      session
    );
    if (!account) {
      throw new Error("Account not found");
    }

    // Check if deposit already processed (idempotency)
    const existingPayment = await Payment.findOne({
      paymentReference: reference,
    }).session(session);
    if (existingPayment && existingPayment.status === "completed") {
      await session.commitTransaction();
      return res.status(201).json({
        success: true,
        message: "Deposit already processed",
        payment: existingPayment,
        newBalance: account.balance,
      });
    }

    // ✅ Create payment record - NO ENCRYPTION
    const payment = new Payment({
      accountId: account._id,
      paymentMethod: "mobile_money",
      amount,
      currency: account.currency,
      status: "completed",
      recipient: {
        name: "Mobile Money Deposit",
        phone: paystackData.metadata.phoneNumber, // ✅ Plain text - NO encryption
        network: paystackData.metadata.network,
      },
      paymentReference: reference,
      processedAt: new Date(),
    });

    // ✅ Create transaction record (CREDIT)
    const balanceBefore = account.balance;
    account.balance += amount;
    const balanceAfter = account.balance;

    console.log(
      `[${req.id}] 💳 Balance updated: ${balanceBefore} → ${balanceAfter}`
    );

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
        phoneNumber: paystackData.metadata.phoneNumber, // ✅ Plain text
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

    console.log(`[${req.id}] ✅ Deposit completed successfully`);

    return res.status(201).json({
      success: true,
      message: "Deposit completed successfully",
      payment,
      newBalance: account.balance,
    });
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

    // You can process webhook events here
    if (event.event === "charge.success") {
      console.log("[WEBHOOK] 💰 Payment successful:", event.data.reference);
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
    console.log(`[${req.id}] 📜 Payment history request`, {
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
    });

    const account = await Account.findOne({ userId: req.user.id });
    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // ✅ VALIDATE PAGINATION
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

    console.log(`[${req.id}] ✅ Payment history retrieved:`, {
      count,
      page,
      limit,
    });

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
    console.log(
      `[${req.id}] 🔍 Checking payment status:`,
      req.params.reference
    );

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

    console.log(`[${req.id}] ✅ Payment status:`, payment.status);

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
    console.log(`[${req.id}] 🔍 Fetching payment:`, req.params.id);

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

// ✅ Cancel pending payment
router.patch("/:id/cancel", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    console.log(`[${req.id}] ❌ Cancelling payment:`, req.params.id);

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
    const refundAmount = payment.amount;
    account.balance += refundAmount;
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

    console.log(`[${req.id}] ✅ Payment cancelled - Refunded ₵${refundAmount}`);

    res.json({
      success: true,
      message: "Payment cancelled successfully",
      payment,
      refundedAmount,
      newBalance: account.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error(`[${req.id}] ❌ Payment cancellation error:`, err.message);
    res.status(400).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

export default router;
