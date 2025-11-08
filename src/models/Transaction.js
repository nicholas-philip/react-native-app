// models/Transaction.js
import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Account",
    required: true,
  },
  type: {
    type: String,
    enum: ["deposit", "withdrawal", "transfer_in", "transfer_out", "payment"],
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
    enum: ["pending", "completed", "failed", "cancelled"],
    default: "pending",
  },
  description: {
    type: String,
    default: "",
  },
  recipientAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Account",
  },
  recipientAccountNumber: {
    type: String,
  },
  balanceBefore: {
    type: Number,
    required: true,
  },
  balanceAfter: {
    type: Number,
    required: true,
  },
  reference: {
    type: String,
    required: true,
  },
  metadata: {
    type: Map,
    of: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: {
    type: Date,
  },
});

// ✅ FIXED: Compound index allows same reference for different types
// This enables: TRF123 (transfer_out) + TRF123 (transfer_in) on same transaction
transactionSchema.index({ reference: 1, type: 1 }, { unique: true });

const Transaction = mongoose.model("Transaction", transactionSchema);
export default Transaction;
