import mongoose from "mongoose";

const accountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  accountNumber: {
    type: String,
    required: true,
    unique: true,
    sparse: true,
    index: true,
  },
  accountType: {
    type: String,
    enum: ["savings", "checking"],
    default: "savings",
  },
  balance: {
    type: Number,
    default: 0,
    min: 0,
  },
  currency: {
    type: String,
    default: "GHS",
  },
  status: {
    type: String,
    enum: ["active", "frozen", "closed"],
    default: "active",
    index: true,
  },
  personalInfo: {
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    dateOfBirth: {
      type: Date,
      required: true,
    },
  },
  contactInfo: {
    phoneNumber: {
      type: String,
      required: true,
      // ✅ Store encrypted
    },
    address: {
      type: String,
      required: true,
    },
    city: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      required: true,
    },
    postalCode: {
      type: String,
    },
    country: {
      type: String,
      default: "Ghana",
    },
  },
  identification: {
    idType: {
      type: String,
      enum: ["NATIONAL_ID", "PASSPORT", "DRIVER_LICENSE"],
      required: true,
    },
    idNumber: {
      type: String,
      required: true,
      // ✅ Store encrypted
    },
    verified: {
      type: Boolean,
      default: false,
    },
  },
  employment: {
    occupation: {
      type: String,
      required: true,
    },
    monthlyIncome: {
      type: Number,
      required: true,
    },
  },
  verificationLevel: {
    type: String,
    enum: ["basic", "verified", "premium"],
    default: "basic",
  },
  lastLoginAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  deletedAt: {
    type: Date,
    default: null, // ✅ Soft delete
  },
});

// Indexes for fast lookups
accountSchema.index({ userId: 1 });
accountSchema.index({ accountNumber: 1 });
accountSchema.index({ status: 1 });
accountSchema.index({ createdAt: -1 });

// Soft delete query helper
accountSchema.query.notDeleted = function () {
  return this.where({ deletedAt: null });
};

// Pre-save hook to update timestamp
accountSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// ✅ UNIQUE INDEX FIX: Handle duplicate account number error
accountSchema.post("save", function (error, doc, next) {
  if (error.name === "MongoServerError" && error.code === 11000) {
    // Duplicate key error
    if (error.keyPattern.accountNumber) {
      next(
        new Error("Account number already exists. Please generate a new one.")
      );
    } else {
      next(error);
    }
  } else {
    next(error);
  }
});

const Account = mongoose.model("Account", accountSchema);
export default Account;
