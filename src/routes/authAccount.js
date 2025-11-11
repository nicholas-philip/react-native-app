import express from "express";
import authMiddleware from "../middleware/auth.js";
import Account from "../models/Account.js";
import User from "../models/user.js";
import {
  validatePhoneNumber,
  validateDateOfBirth,
  validateIdNumber,
  validateEmail,
  sanitizeString,
  encryptSensitiveData,
  decryptSensitiveData,
} from "../utils/helpers.js";

const router = express.Router();

// ✅ FIXED: Generate unique 10-digit account number with retry logic
const generateAccountNumber = async () => {
  const MAX_RETRIES = 10;

  for (let i = 0; i < MAX_RETRIES; i++) {
    const prefix = "10"; // Bank prefix
    const randomDigits = Math.floor(Math.random() * 100000000)
      .toString()
      .padStart(8, "0");
    const accountNumber = prefix + randomDigits;

    // Check if unique
    const existing = await Account.findOne({ accountNumber });
    if (!existing) {
      return accountNumber;
    }
  }

  throw new Error(
    "Failed to generate unique account number. Please try again."
  );
};

// Get user account
router.get("/getUserAccount", authMiddleware, async (req, res) => {
  try {
    console.log(`[${req.id}] 🔍 Getting account for user:`, req.user.id);

    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      console.log(`[${req.id}] ❌ No account found for user:`, req.user.id);
      return res.status(404).json({
        success: false,
        message: "Account not found. Please complete account setup.",
      });
    }

    console.log(`[${req.id}] ✅ Account found:`, account.accountNumber);

    res.json({
      success: true,
      accountNumber: account.accountNumber,
      accountType: account.accountType,
      balance: account.balance,
      currency: account.currency,
      status: account.status,
      verificationLevel: account.verificationLevel,
      personalInfo: {
        firstName: account.personalInfo?.firstName,
        lastName: account.personalInfo?.lastName,
      },
      createdAt: account.createdAt,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ getUserAccount error:`, err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// Complete account setup with full details
router.post("/setup", authMiddleware, async (req, res) => {
  try {
    console.log(`[${req.id}] 🔧 Upgrading account for user:`, req.user.id);

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

    // ✅ INPUT VALIDATION
    if (!firstName || !lastName || !dateOfBirth) {
      return res.status(400).json({
        success: false,
        message: "Please provide all personal information",
      });
    }

    // Validate name (alphanumeric + spaces, max 50 chars)
    const nameRegex = /^[a-zA-Z\s'-]{2,50}$/;
    if (!nameRegex.test(firstName) || !nameRegex.test(lastName)) {
      return res.status(400).json({
        success: false,
        message: "Invalid first or last name",
      });
    }

    // Validate date of birth
    const dobValidation = validateDateOfBirth(dateOfBirth);
    if (!dobValidation.valid) {
      return res.status(400).json({
        success: false,
        message: dobValidation.error,
      });
    }

    // Validate phone number
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
      return res.status(400).json({
        success: false,
        message: phoneValidation.error,
      });
    }

    // Validate address
    if (!address || address.length < 5 || address.length > 200) {
      return res.status(400).json({
        success: false,
        message: "Address must be between 5 and 200 characters",
      });
    }

    if (!city || !state || !country) {
      return res.status(400).json({
        success: false,
        message: "Please provide all contact information",
      });
    }

    // Validate ID
    const idValidation = validateIdNumber(idNumber, idType);
    if (!idValidation.valid) {
      return res.status(400).json({
        success: false,
        message: idValidation.error,
      });
    }

    // Validate occupation and income
    if (!occupation || occupation.length < 2 || occupation.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid employment information",
      });
    }

    if (!monthlyIncome || monthlyIncome < 0 || monthlyIncome > 10000000) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid monthly income",
      });
    }

    // ✅ Find existing account
    let account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found. Please contact support.",
      });
    }

    // ✅ UPDATE existing account with full details (upgrade)
    account.personalInfo = {
      firstName: sanitizeString(firstName, 50),
      lastName: sanitizeString(lastName, 50),
      dateOfBirth: dobValidation.dateOfBirth,
    };

    account.contactInfo = {
      phoneNumber: encryptSensitiveData(phoneValidation.phoneNumber),
      address: sanitizeString(address, 200),
      city: sanitizeString(city, 100),
      state: sanitizeString(state, 100),
      postalCode: sanitizeString(postalCode || "", 20),
      country: sanitizeString(country, 100) || "Ghana",
    };

    // ✅ Store normalized phone number for searching (unencrypted)
    account.searchablePhone = phoneValidation.phoneNumber.replace(/\D/g, "");

    account.identification = {
      idType,
      idNumber: encryptSensitiveData(idValidation.idNumber),
      verified: false,
    };

    account.employment = {
      occupation: sanitizeString(occupation, 100),
      monthlyIncome,
    };

    // ✅ CRITICAL: Update verification level and status
    account.verificationLevel = "basic"; // Basic verification after completing profile
    account.status = "active"; // ✅ CHANGE FROM PENDING TO ACTIVE
    account.lastActivity = new Date();

    await account.save();

    // ✅ Update user profile
    await User.findByIdAndUpdate(req.user.id, {
      profileCompleted: true,
      fullName: `${firstName} ${lastName}`,
    });

    console.log(`[${req.id}] ✅ Account upgraded successfully`);
    console.log(`[${req.id}] 📝 Status: pending → active`);
    console.log(`[${req.id}] 📝 Verification: unverified → basic`);

    res.json({
      success: true,
      message: "Account setup completed successfully",
      accountNumber: account.accountNumber,
      verificationLevel: account.verificationLevel,
      account: {
        accountNumber: account.accountNumber,
        accountType: account.accountType,
        balance: account.balance,
        currency: account.currency,
        status: account.status,
        verificationLevel: account.verificationLevel,
      },
    });
  } catch (error) {
    console.error(`[${req.id}] ❌ Account setup error:`, error);

    res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
});

// ✅ Get full account details (FIXED - Safe decryption)
router.get("/details", authMiddleware, async (req, res) => {
  try {
    console.log(
      `[${req.id}] 🔍 Getting account details for user:`,
      req.user.id
    );

    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      console.log(`[${req.id}] ❌ No account found for user:`, req.user.id);
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    console.log(`[${req.id}] ✅ Account found:`, account.accountNumber);

    // ✅ SAFE decryption - handle null/undefined values
    let phoneNumber = "Not provided";
    let idNumber = "Not provided";

    try {
      if (account.contactInfo?.phoneNumber) {
        phoneNumber = decryptSensitiveData(account.contactInfo.phoneNumber);
        console.log(`[${req.id}] ✅ Phone decrypted successfully`);
      }
    } catch (decryptErr) {
      console.warn(
        `[${req.id}] ⚠ Could not decrypt phone:`,
        decryptErr.message
      );
      phoneNumber = account.contactInfo?.phoneNumber || "Not provided";
    }

    try {
      if (account.identification?.idNumber) {
        idNumber = decryptSensitiveData(account.identification.idNumber);
        console.log(`[${req.id}] ✅ ID decrypted successfully`);
      }
    } catch (decryptErr) {
      console.warn(`[${req.id}] ⚠ Could not decrypt ID:`, decryptErr.message);
      idNumber = account.identification?.idNumber || "Not provided";
    }

    // ✅ Return safe data
    const responseData = {
      success: true,
      account: {
        accountNumber: account.accountNumber,
        accountType: account.accountType,
        balance: account.balance,
        currency: account.currency,
        status: account.status,
        verificationLevel: account.verificationLevel,
        personalInfo: {
          firstName: account.personalInfo?.firstName || "Not provided",
          lastName: account.personalInfo?.lastName || "Not provided",
          dateOfBirth: account.personalInfo?.dateOfBirth || null,
        },
        contactInfo: {
          phoneNumber,
          address: account.contactInfo?.address || "Not provided",
          city: account.contactInfo?.city || "Not provided",
          state: account.contactInfo?.state || "Not provided",
          postalCode: account.contactInfo?.postalCode || "Not provided",
          country: account.contactInfo?.country || "Ghana",
        },
        identification: {
          idType: account.identification?.idType || "Not provided",
          idNumber,
          verified: account.identification?.verified || false,
        },
        employment: {
          occupation: account.employment?.occupation || "Not provided",
          monthlyIncome: account.employment?.monthlyIncome || 0,
        },
        createdAt: account.createdAt,
      },
    };

    console.log(`[${req.id}] ✅ Account details response ready`);
    res.json(responseData);
  } catch (error) {
    console.error(`[${req.id}] ❌ Get account details error:`, error);
    console.error(`[${req.id}] Error stack:`, error.stack);
    res.status(500).json({
      success: false,
      message: "Server error: " + error.message,
      requestId: req.id,
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

    // ✅ VALIDATE AND UPDATE allowed fields
    if (phoneNumber) {
      const phoneValidation = validatePhoneNumber(phoneNumber);
      if (!phoneValidation.valid) {
        return res.status(400).json({
          success: false,
          message: phoneValidation.error,
        });
      }
      account.contactInfo.phoneNumber = encryptSensitiveData(
        phoneValidation.phoneNumber
      );
      // ✅ Update searchable phone field
      account.searchablePhone = phoneValidation.phoneNumber.replace(/\D/g, "");
    }

    if (address) {
      if (address.length < 5 || address.length > 200) {
        return res.status(400).json({
          success: false,
          message: "Address must be between 5 and 200 characters",
        });
      }
      account.contactInfo.address = sanitizeString(address, 200);
    }

    if (city) {
      account.contactInfo.city = sanitizeString(city, 100);
    }

    if (state) {
      account.contactInfo.state = sanitizeString(state, 100);
    }

    if (postalCode) {
      account.contactInfo.postalCode = sanitizeString(postalCode, 20);
    }

    if (occupation) {
      if (occupation.length < 2 || occupation.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Occupation must be between 2 and 100 characters",
        });
      }
      account.employment.occupation = sanitizeString(occupation, 100);
    }

    if (monthlyIncome !== undefined) {
      if (monthlyIncome < 0 || monthlyIncome > 10000000) {
        return res.status(400).json({
          success: false,
          message: "Invalid monthly income",
        });
      }
      account.employment.monthlyIncome = monthlyIncome;
    }

    await account.save();

    res.json({
      success: true,
      message: "Account updated successfully",
      account: {
        accountNumber: account.accountNumber,
        status: account.status,
      },
    });
  } catch (error) {
    console.error(`[${req.id}] ❌ Update account error:`, error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Check if user has completed account setup
router.get("/check", authMiddleware, async (req, res) => {
  try {
    console.log(`[${req.id}] 🔍 Checking account for user:`, req.user.id);

    const account = await Account.findOne({ userId: req.user.id });

    res.json({
      success: true,
      hasAccount: !!account,
      accountNumber: account?.accountNumber || null,
      profileCompleted: account?.personalInfo?.firstName ? true : false,
      status: account?.status || null,
    });
  } catch (error) {
    console.error(`[${req.id}] ❌ Check account error:`, error);
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
        message: "Invalid status. Must be: active, frozen, or closed",
      });
    }

    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    const previousStatus = account.status;
    account.status = status;
    await account.save();

    console.log(
      `[${req.id}] 📝 Account status updated:`,
      previousStatus,
      "->",
      status
    );

    res.json({
      success: true,
      message: `Account status changed from ${previousStatus} to ${status}`,
      status: account.status,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ Status update error:`, err.message);
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

    if (account.status !== "active") {
      return res.status(400).json({
        success: false,
        message: "Account is not active",
      });
    }

    res.json({
      success: true,
      account,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ Account lookup error:`, err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ LOOKUP ACCOUNT BY PHONE NUMBER (uses searchablePhone)
router.get("/lookup", authMiddleware, async (req, res) => {
  try {
    const { phone } = req.query;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    // Normalize phone number (remove +, spaces, etc.)
    const normalizedPhone = phone.replace(/\D/g, "");

    console.log(
      `[${req.id}] 🔍 Looking up account for phone:`,
      normalizedPhone
    );

    // ✅ SEARCH using searchablePhone field (unencrypted, searchable)
    const account = await Account.findOne({
      searchablePhone: normalizedPhone,
    });

    if (!account) {
      console.log(
        `[${req.id}] ❌ No account found for phone:`,
        normalizedPhone
      );
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (account.status !== "active") {
      return res.status(400).json({
        success: false,
        message: "Account is not active",
      });
    }

    console.log(`[${req.id}] ✅ Account found:`, account.accountNumber);

    // ✅ Safe decryption for response
    let phoneDisplay = "N/A";
    try {
      if (account.contactInfo?.phoneNumber) {
        phoneDisplay = decryptSensitiveData(account.contactInfo.phoneNumber);
      }
    } catch (e) {
      phoneDisplay = account.contactInfo?.phoneNumber || "N/A";
    }

    res.json({
      success: true,
      accountNumber: account.accountNumber,
      phoneNumber: phoneDisplay,
      accountHolder: `${account.personalInfo?.firstName || "User"} ${
        account.personalInfo?.lastName || ""
      }`.trim(),
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ Lookup error:`, err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ GET ACCOUNT BY ID
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);

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
