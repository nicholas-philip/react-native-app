// =============== routes/authRoutes.js (OPTIMIZED) ===============

import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import Account from "../models/Account.js";
import jwt from "jsonwebtoken";
import protectRoute from "../middleware/authmiddleware.js";
import mongoose from "mongoose";

const router = express.Router();

// ✅ Create JWT token
const createToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

// ✅ Generate unique account number
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

  throw new Error("Failed to generate unique account number");
};

// ✅ Validate email format
const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

// ✅ Register Route - Creates BASIC account (minimal info)
router.post("/register", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { username, email, password } = req.body;

    // ✅ Validate inputs
    if (!username || !email || !password) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // ✅ Validate username
    if (username.length < 3 || username.length > 30) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Username must be between 3 and 30 characters",
      });
    }

    // ✅ Validate email format
    if (!validateEmail(email)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // ✅ Validate password
    if (password.length < 6) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    // ✅ Check if email exists
    const existingEmail = await User.findOne({
      email: email.toLowerCase(),
    }).session(session);

    if (existingEmail) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: "Email already in use",
      });
    }

    // ✅ Check if username exists
    const existingUsername = await User.findOne({
      username: username.toLowerCase(),
    }).session(session);

    if (existingUsername) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: "Username already in use",
      });
    }

    // ✅ Generate profile image
    const profileImage = `https://api.dicebear.com/6.x/initials/svg?seed=${username}`;

    // ✅ CREATE USER
    const user = new User({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      profileImage,
    });

    await user.save({ session });
    console.log(`✅ User registered:`, user.email);

    // ✅ CREATE BASIC ACCOUNT (only required fields)
    const accountNumber = await generateAccountNumber();
    const account = new Account({
      userId: user._id,
      accountNumber,
      balance: 0,
      currency: "GHS",
      status: "pending", // ✅ Pending until setup complete
      accountType: "savings",
      verificationLevel: "unverified",
      // ✅ NO optional fields - they're filled in /setup route
    });

    await account.save({ session });
    console.log(`✅ Basic account created:`, account.accountNumber);

    // ✅ Update user with accountId reference
    user.accountId = account._id;
    await user.save({ session });

    await session.commitTransaction();

    // ✅ Create token
    const token = createToken(user._id);

    res.status(201).json({
      success: true,
      message: "User registered successfully. Please complete your profile.",
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        profileImage: user.profileImage,
        accountId: account._id,
        profileCompleted: false, // ✅ Not completed yet
      },
      account: {
        _id: account._id,
        accountNumber,
        balance: account.balance,
        currency: account.currency,
        status: account.status,
        verificationLevel: account.verificationLevel,
        requiresSetup: true, // ✅ Flag to redirect to setup
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error(`❌ Registration error:`, error.message);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email or username already exists",
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  } finally {
    session.endSession();
  }
});

// ✅ Login Route
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // ✅ Validate inputs
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // ✅ Find user (include password field)
    const user = await User.findOne({
      email: email.toLowerCase(),
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // ✅ Compare password
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // ✅ Get account info
    const account = await Account.findOne({ userId: user._id });

    if (!account) {
      // Fallback: Create basic account if missing
      console.warn(`⚠️ Account missing for user ${user._id}, creating...`);
      const newAccount = new Account({
        userId: user._id,
        accountNumber: await generateAccountNumber(),
        balance: 0,
        currency: "GHS",
        status: "pending",
      });
      await newAccount.save();
      user.accountId = newAccount._id;
      await user.save();
    }

    // ✅ Update last login
    user.lastLoginAt = new Date();
    await user.save();

    // ✅ Create token
    const token = createToken(user._id);

    console.log(`✅ User logged in:`, user.email);

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        profileImage: user.profileImage,
        accountId: user.accountId,
        profileCompleted: user.profileCompleted,
      },
      account: account
        ? {
            _id: account._id,
            accountNumber: account.accountNumber,
            balance: account.balance,
            currency: account.currency,
            status: account.status,
            verificationLevel: account.verificationLevel,
            requiresSetup: !account.personalInfo?.firstName, // ✅ Check if needs setup
          }
        : null,
    });
  } catch (error) {
    console.error(`❌ Login error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
});

// ✅ Get Current User Route
router.get("/me", protectRoute, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Also fetch account info
    const account = await Account.findOne({ userId: user._id });

    res.json({
      success: true,
      user,
      account: account
        ? {
            _id: account._id,
            accountNumber: account.accountNumber,
            balance: account.balance,
            currency: account.currency,
            status: account.status,
            verificationLevel: account.verificationLevel,
            requiresSetup: !account.personalInfo?.firstName,
          }
        : null,
    });
  } catch (error) {
    console.error(`❌ Get user error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
});

export default router;
