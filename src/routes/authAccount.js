import express from "express";
import authMiddleware from "../middleware/auth.js";
import Account from "../models/Account.js";
import User from "../models/user.js";

const router = express.Router();

// Generate unique 10-digit account number
const generateAccountNumber = () => {
  const prefix = "10"; // Bank prefix
  const randomDigits = Math.floor(Math.random() * 100000000)
    .toString()
    .padStart(8, "0");
  return prefix + randomDigits;
};

// Get user account
router.get("/getUserAccount", authMiddleware, async (req, res) => {
  try {
    console.log("🔍 Getting account for user:", req.user.id);

    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      console.log("❌ No account found for user:", req.user.id);
      return res.status(404).json({
        success: false,
        message: "Account not found. Please complete account setup.",
      });
    }

    console.log("✅ Account found:", account.accountNumber);

    res.json({
      success: true,
      accountNumber: account.accountNumber,
      accountType: account.accountType,
      balance: account.balance,
      currency: account.currency,
      status: account.status,
      personalInfo: account.personalInfo,
      contactInfo: account.contactInfo,
      createdAt: account.createdAt,
    });
  } catch (err) {
    console.error("❌ getUserAccount error:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// Complete account setup with full details
router.post("/setup", authMiddleware, async (req, res) => {
  try {
    console.log("🔧 Setting up account for user:", req.user.id);

    const {
      firstName,
      lastName,
      dateOfBirth,
      phoneNumber,
      address,
      city,
      state,
      postalCode,
      country,
      idType,
      idNumber,
      occupation,
      monthlyIncome,
    } = req.body;

    // Validation
    if (!firstName || !lastName || !dateOfBirth) {
      return res.status(400).json({
        success: false,
        message: "Please provide all personal information",
      });
    }

    if (!phoneNumber || !address || !city || !state || !country) {
      return res.status(400).json({
        success: false,
        message: "Please provide all contact information",
      });
    }

    if (!idType || !idNumber) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid identification",
      });
    }

    if (!occupation || !monthlyIncome) {
      return res.status(400).json({
        success: false,
        message: "Please provide employment information",
      });
    }

    // Check if user already has an account
    const existingAccount = await Account.findOne({ userId: req.user.id });
    if (existingAccount) {
      return res.status(400).json({
        success: false,
        message: "Account already exists for this user",
      });
    }

    // Generate unique account number
    let accountNumber;
    let isUnique = false;

    while (!isUnique) {
      accountNumber = generateAccountNumber();
      const existingAccNum = await Account.findOne({ accountNumber });
      if (!existingAccNum) {
        isUnique = true;
      }
    }

    // Create new account
    const account = new Account({
      userId: req.user.id,
      accountNumber,
      accountType: "savings",
      balance: 0,
      currency: "GHS",
      status: "active",
      personalInfo: {
        firstName,
        lastName,
        dateOfBirth,
      },
      contactInfo: {
        phoneNumber,
        address,
        city,
        state,
        postalCode,
        country,
      },
      identification: {
        idType,
        idNumber,
        verified: false,
      },
      employment: {
        occupation,
        monthlyIncome,
      },
    });

    await account.save();

    // Update user profile with account reference
    await User.findByIdAndUpdate(req.user.id, {
      accountId: account._id,
      profileCompleted: true,
      fullName: `${firstName} ${lastName}`,
    });

    console.log("✅ Account created successfully:", accountNumber);

    res.json({
      success: true,
      message: "Account created successfully",
      accountNumber: accountNumber,
      account: {
        accountNumber: account.accountNumber,
        accountType: account.accountType,
        balance: account.balance,
        currency: account.currency,
        status: account.status,
      },
    });
  } catch (error) {
    console.error("❌ Account setup error:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
});

// Get full account details
router.get("/details", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    res.json({
      success: true,
      account: {
        accountNumber: account.accountNumber,
        accountType: account.accountType,
        balance: account.balance,
        currency: account.currency,
        status: account.status,
        personalInfo: account.personalInfo,
        contactInfo: account.contactInfo,
        identification: {
          idType: account.identification?.idType,
          verified: account.identification?.verified,
        },
        employment: account.employment,
        createdAt: account.createdAt,
      },
    });
  } catch (error) {
    console.error("❌ Get account error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Update account information
router.put("/update", authMiddleware, async (req, res) => {
  try {
    const {
      phoneNumber,
      address,
      city,
      state,
      postalCode,
      occupation,
      monthlyIncome,
    } = req.body;

    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // Update allowed fields
    if (phoneNumber) account.contactInfo.phoneNumber = phoneNumber;
    if (address) account.contactInfo.address = address;
    if (city) account.contactInfo.city = city;
    if (state) account.contactInfo.state = state;
    if (postalCode) account.contactInfo.postalCode = postalCode;
    if (occupation) account.employment.occupation = occupation;
    if (monthlyIncome) account.employment.monthlyIncome = monthlyIncome;

    await account.save();

    res.json({
      success: true,
      message: "Account updated successfully",
      account,
    });
  } catch (error) {
    console.error("❌ Update account error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Check if user has completed account setup
router.get("/check", authMiddleware, async (req, res) => {
  try {
    console.log("🔍 Checking account for user:", req.user.id);

    const account = await Account.findOne({ userId: req.user.id });

    res.json({
      success: true,
      hasAccount: !!account,
      accountNumber: account?.accountNumber || null,
      profileCompleted: account?.personalInfo?.firstName ? true : false,
    });
  } catch (error) {
    console.error("❌ Check account error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Update account status (freeze/unfreeze/close)
router.patch("/userAccountStatus", authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    if (!["active", "frozen", "closed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    account.status = status;
    await account.save();

    res.json({
      success: true,
      account,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
});

// Get account by account number (for transfers)
router.get("/number/:accountNumber", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      accountNumber: req.params.accountNumber,
    }).select("accountNumber accountType status -_id");

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    res.json({
      success: true,
      account,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

export default router;
