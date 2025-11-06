// models/Payment.js
import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Account",
    required: true,
  },
  paymentMethod: {
    type: String,
    enum: ["card", "bank_transfer", "wallet"],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    default: "USD",
  },
  status: {
    type: String,
    enum: ["pending", "processing", "completed", "failed"],
    default: "pending",
  },
  recipient: {
    name: {
      type: String,
      required: true,
    },
    accountNumber: {
      type: String,
    },
    bankName: {
      type: String,
    },
  },
  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Transaction",
  },
  paymentReference: {
    type: String,
    unique: true,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  processedAt: {
    type: Date,
  },
});

// Indexes for fast lookups

paymentSchema.index({ accountId: 1, createdAt: -1 });

const Payment = mongoose.model("Payment", paymentSchema);
export default Payment;
