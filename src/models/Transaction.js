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

// Indexes for better query performance

transactionSchema.index({ reference: 1 });

const Transaction = mongoose.model("Transaction", transactionSchema);
export default Transaction;
