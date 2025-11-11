// =============== models/Account.js (COMPLETE REPLACEMENT) ===============
import mongoose from "mongoose";

const accountSchema = new mongoose.Schema(
  {
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
      trim: true,
      index: true,
    },
    accountType: {
      type: String,
      enum: ["savings", "checking", "business"],
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
      enum: ["GHS", "USD", "EUR", "GBP"],
    },
    status: {
      type: String,
      enum: ["active", "frozen", "closed", "pending"],
      default: "pending",
      index: true,
    },
    verificationLevel: {
      type: String,
      enum: ["basic", "verified", "unverified"],
      default: "unverified",
    },

    // Personal Information
    personalInfo: {
      firstName: {
        type: String,
        required: false,
        trim: true,
      },
      lastName: {
        type: String,
        required: false,
        trim: true,
      },
      dateOfBirth: {
        type: Date,
        required: false,
      },
    },

    // Contact Information
    contactInfo: {
      phoneNumber: {
        type: String,
        required: false, // Encrypted
      },
      address: {
        type: String,
        required: false,
      },
      city: {
        type: String,
        required: false,
      },
      state: {
        type: String,
        required: false,
      },
      postalCode: {
        type: String,
        required: false,
      },
      country: {
        type: String,
        default: "Ghana",
      },
    },

    // ✅ SEARCHABLE PHONE - Unencrypted for lookups
    searchablePhone: {
      type: String,
      index: true,
      default: null,
      sparse: true,
    },

    // Identification
    identification: {
      idType: {
        type: String,
        enum: ["passport", "national_id", "drivers_license", "voter_id", ""],
        required: false,
      },
      idNumber: {
        type: String,
        required: false, // Encrypted
      },
      verified: {
        type: Boolean,
        default: false,
      },
    },

    // Employment
    employment: {
      occupation: {
        type: String,
        required: false,
      },
      monthlyIncome: {
        type: Number,
        required: false,
        min: 0,
      },
    },

    lastActivity: {
      type: Date,
      default: Date.now,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Indexes for performance
accountSchema.index({ userId: 1 });
accountSchema.index({ accountNumber: 1 });
accountSchema.index({ status: 1 });
accountSchema.index({ createdAt: -1 });
accountSchema.index({ searchablePhone: 1, status: 1 }); // ✅ Compound index

// ✅ Soft delete query helper
accountSchema.query.notDeleted = function () {
  return this.where({ deletedAt: null });
};

// ✅ Virtual to check if profile is complete
accountSchema.virtual("isProfileComplete").get(function () {
  return !!(
    this.personalInfo?.firstName &&
    this.personalInfo?.lastName &&
    this.personalInfo?.dateOfBirth &&
    this.contactInfo?.phoneNumber &&
    this.contactInfo?.address &&
    this.identification?.idNumber
  );
});

// ✅ Method to check if account can transact
accountSchema.methods.canTransact = function () {
  return this.status === "active" && this.verificationLevel !== "unverified";
};

// ✅ Handle duplicate account number errors
accountSchema.post("save", function (error, doc, next) {
  if (error.name === "MongoServerError" && error.code === 11000) {
    if (error.keyPattern?.accountNumber) {
      next(
        new Error("Account number already exists. Please generate a new one.")
      );
    } else if (error.keyPattern?.userId) {
      next(new Error("User already has an account."));
    } else {
      next(error);
    }
  } else {
    next(error);
  }
});

// ✅ Prevent model overwrite error
delete mongoose.connection.models["Account"];

const Account = mongoose.model("Account", accountSchema);

export default Account;
