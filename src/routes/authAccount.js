// ================== routes/authAccount.js ==================
import express from "express";
import Account from "../models/Account.js";
import User from "../models/user.js";
import authMiddleware from "../middleware/auth.js";
import mongoose from "mongoose";
import { generateAccountNumber, generateReference } from "../utils/helpers.js";

const router = express.Router();

// ✅ GET user's account (NO PARAMETERS - THIS IS THE FIX)
router.get("/details", authMiddleware, async (req, res) => {
  try {
    console.log(
      `[${req.id}] 🔍 Fetching account details for user:`,
      req.user.id
    );

    const account = await Account.findOne({ userId: req.user.id });

    if (!account) {
      console.log(`[${req.id}] ❌ Account not found for user:`, req.user.id);
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    console.log(`[${req.id}] ✅ Account found:`, account.accountNumber);

    res.json({
      success: true,
      account,
    });
  } catch (err) {
    console.error(`[${req.id}] ❌ Error fetching account:`, err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ Check if account exists and is setup
router.get("/check", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });

    res.json({
      success: true,
      exists: !!account,
      account: account || null,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ Setup account with personal details
router.post("/setup", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      firstName,
      lastName,
      dateOfBirth,
      phoneNumber,
      address,
      city,
      state,
      postalCode,
      occupation,
      monthlyIncome,
    } = req.body;

    console.log(`[${req.id}] 📝 Setting up account for user:`, req.user.id);

    // Find user
    const user = await User.findById(req.user.id).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find or create account
    let account = await Account.findOne({ userId: req.user.id }).session(
      session
    );

    if (!account) {
      // Create new account
      const accountNumber = await generateAccountNumber();
      account = new Account({
        userId: req.user.id,
        accountNumber,
        balance: 0,
        currency: "GHS",
        status: "active",
        accountType: "savings",
        verificationLevel: "unverified",
      });
    }

    // Update personal information
    if (firstName || lastName || dateOfBirth) {
      account.personalInfo = {
        firstName: firstName || account.personalInfo?.firstName,
        lastName: lastName || account.personalInfo?.lastName,
        dateOfBirth: dateOfBirth || account.personalInfo?.dateOfBirth,
      };
    }

    // Update contact information
    if (phoneNumber || address || city || state || postalCode) {
      account.contactInfo = {
        phoneNumber: phoneNumber || account.contactInfo?.phoneNumber,
        address: address || account.contactInfo?.address,
        city: city || account.contactInfo?.city,
        state: state || account.contactInfo?.state,
        postalCode: postalCode || account.contactInfo?.postalCode,
        country: "Ghana",
      };
    }

    // Update employment information
    if (occupation || monthlyIncome) {
      account.employment = {
        occupation: occupation || account.employment?.occupation,
        monthlyIncome: monthlyIncome || account.employment?.monthlyIncome,
      };
    }

    // Mark as verified if profile is complete
    if (account.isProfileComplete) {
      account.status = "active";
      account.verificationLevel = "verified";
    }

    await account.save({ session });

    // Update user
    user.profileCompleted = true;
    await user.save({ session });

    await session.commitTransaction();

    console.log(`[${req.id}] ✅ Account setup completed`);

    res.json({
      success: true,
      message: "Account setup completed successfully",
      account,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error(`[${req.id}] ❌ Account setup error:`, err.message);
    res.status(400).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

// ✅ Update account information
router.put("/update", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

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

    const account = await Account.findOne({ userId: req.user.id }).session(
      session
    );

    if (!account) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // Update fields
    if (phoneNumber) account.contactInfo.phoneNumber = phoneNumber;
    if (address) account.contactInfo.address = address;
    if (city) account.contactInfo.city = city;
    if (state) account.contactInfo.state = state;
    if (postalCode) account.contactInfo.postalCode = postalCode;
    if (occupation) account.employment.occupation = occupation;
    if (monthlyIncome) account.employment.monthlyIncome = monthlyIncome;

    await account.save({ session });
    await session.commitTransaction();

    console.log(`[${req.id}] ✅ Account updated`);

    res.json({
      success: true,
      message: "Account updated successfully",
      account,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error(`[${req.id}] ❌ Update error:`, err.message);
    res.status(400).json({
      success: false,
      message: err.message,
    });
  } finally {
    session.endSession();
  }
});

// ✅ Get account details (alternative endpoint)
router.get("/number/:accountNumber", authMiddleware, async (req, res) => {
  try {
    const account = await Account.findOne({
      accountNumber: req.params.accountNumber,
    }).select("accountNumber personalInfo contactInfo status");

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

// ✅ Update account status
router.patch("/userAccountStatus", authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    if (!["active", "frozen", "closed", "pending"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const account = await Account.findOneAndUpdate(
      { userId: req.user.id },
      { status },
      { new: true }
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    res.json({
      success: true,
      message: `Account status updated to ${status}`,
      account,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ✅ Lookup account by phone (for transfers)
router.get("/lookup", authMiddleware, async (req, res) => {
  try {
    const { phone, accountNumber } = req.query;

    if (!phone && !accountNumber) {
      return res.status(400).json({
        success: false,
        message: "Phone or account number required",
      });
    }

    let query = {};
    if (accountNumber) query.accountNumber = accountNumber;
    if (phone) query["contactInfo.phoneNumber"] = phone;

    const account = await Account.findOne(query).select(
      "accountNumber personalInfo status"
    );

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
