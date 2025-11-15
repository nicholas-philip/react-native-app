// =============== models/Payment.js (COMPLETE FIX) ===============
import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["card", "wallet", "transfer", "mobile_money", "bank_transfer"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "GHS",
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    recipient: {
      name: String,
      accountNumber: String,
      phone: String,
      network: String, // MTN, VODAFONE, TIGO
      bankName: String,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
    },
    paymentReference: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
    },
    processedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
paymentSchema.index({ accountId: 1, createdAt: -1 });
paymentSchema.index({ paymentReference: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ paymentMethod: 1 });

const Payment = mongoose.model("Payment", paymentSchema);
export default Payment;
