// =============== routes/authRoutes.js (WITH BREVO EMAIL & DEBUG) ===============
import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import Account from "../models/Account.js";
import jwt from "jsonwebtoken";
import protectRoute from "../middleware/authmiddleware.js";
import mongoose from "mongoose";
import nodemailer from "nodemailer";

const router = express.Router();

// ✅ Setup email transporter (BREVO)
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false, // TLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify transporter connection
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Email transporter error:", error.message);
  } else {
    console.log("✅ Email transporter (Brevo) ready");
  }
});

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
    const prefix = "10";
    const randomDigits = Math.floor(Math.random() * 100000000)
      .toString()
      .padStart(8, "0");
    const accountNumber = prefix + randomDigits;

    const existing = await Account.findOne({ accountNumber });
    if (!existing) {
      return accountNumber;
    }
  }

  throw new Error("Failed to generate unique account number");
};

// ✅ Generate 6-digit verification code
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ✅ Validate email format
const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

// ✅ ENHANCED Send verification email WITH DEBUG
const sendVerificationEmail = async (email, code, username) => {
  try {
    console.log("\n📧 [EMAIL] ═══════════════════════════════════");
    console.log(`📧 [EMAIL] Starting email send`);
    console.log(`   To: ${email}`);
    console.log(`   Code: ${code}`);
    console.log(`   Username: ${username}`);
    console.log(`   From: ${process.env.SENDER_EMAIL}`);
    console.log(
      `   Transporter Status: ${
        transporter ? "✅ Ready" : "❌ Not initialized"
      }`
    );

    const mailOptions = {
      from: process.env.SENDER_EMAIL,
      to: email,
      subject: "Verify Your Tasktuges Account - 6 Digit Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0;">Tasktuges</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 10px 0 0 0;">Email Verification</p>
          </div>
          
          <div style="background-color: #f8f9fa; padding: 40px 20px; border-radius: 0 0 10px 10px;">
            <p style="color: #333; font-size: 16px; margin: 0 0 20px 0;">
              Hi <strong>${username}</strong>,
            </p>
            
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 30px 0;">
              Thank you for signing up! Please verify your email address by entering the code below:
            </p>
            
            <div style="background-color: #fff; padding: 30px; border-radius: 10px; border: 2px dashed #667eea; margin: 30px 0; text-align: center;">
              <p style="color: #999; font-size: 12px; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 1px;">Your verification code</p>
              <div style="font-size: 48px; font-weight: bold; color: #667eea; letter-spacing: 8px; margin: 15px 0; font-family: 'Courier New', monospace;">
                ${code}
              </div>
              <p style="color: #999; font-size: 12px; margin: 15px 0 0 0;">This code will expire in 10 minutes</p>
            </div>

            <p style="color: #666; font-size: 13px; line-height: 1.6; margin: 0 0 20px 0;">
              If you didn't create this account, you can safely ignore this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            
            <p style="color: #999; font-size: 11px; text-align: center; margin: 0;">
              © 2024 Tasktuges. All rights reserved.<br>
              This is an automated message, please do not reply.
            </p>
          </div>
        </div>
      `,
    };

    console.log(`📤 [EMAIL] Sending mail with transporter.sendMail()...`);
    const info = await transporter.sendMail(mailOptions);

    console.log(`✅ [EMAIL] Email sent successfully!`);
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Response: ${info.response}`);
    console.log(`   Accepted: ${JSON.stringify(info.accepted)}`);
    console.log(`   Rejected: ${JSON.stringify(info.rejected)}`);
    console.log(`📧 [EMAIL] ═══════════════════════════════════\n`);

    return true;
  } catch (error) {
    console.error(`\n❌ [EMAIL] Email send FAILED!`);
    console.error(`   Error Message: ${error.message}`);
    console.error(`   Error Code: ${error.code}`);
    console.error(`   Error Command: ${error.command}`);
    console.error(`   Full Error:`, error);
    console.error(`📧 [EMAIL] ═══════════════════════════════════\n`);

    throw new Error(`Failed to send verification email: ${error.message}`);
  }
};

// ✅ REGISTER ROUTE - WITH EMAIL VERIFICATION & DEBUG
router.post("/register", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { username, email, password } = req.body;

    console.log("\n🔐 [REGISTER] ═══════════════════════════════════");
    console.log(`🔐 [REGISTER] New registration attempt`);
    console.log(`   Username: ${username}`);
    console.log(`   Email: ${email}`);

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

    // ✅ Generate verification code
    const verificationCode = generateVerificationCode();
    const verificationCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    console.log(
      `🔐 [REGISTER] Generated verification code: ${verificationCode}`
    );

    // ✅ CREATE USER
    const user = new User({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      profileImage,
      verificationCode,
      verificationCodeExpiresAt,
      emailVerified: false,
    });

    await user.save({ session });
    console.log(`✅ [REGISTER] User created in DB: ${user.email}`);

    // ✅ CREATE BASIC ACCOUNT
    const accountNumber = await generateAccountNumber();
    const account = new Account({
      userId: user._id,
      accountNumber,
      balance: 0,
      currency: "GHS",
      status: "pending",
      accountType: "savings",
      verificationLevel: "unverified",
    });

    await account.save({ session });
    console.log(
      `✅ [REGISTER] Basic account created: ${account.accountNumber}`
    );

    // ✅ Update user with accountId reference
    user.accountId = account._id;
    await user.save({ session });

    await session.commitTransaction();
    console.log(`✅ [REGISTER] Transaction committed`);

    // ✅ Send verification email - WITH DEBUG
    console.log(`\n📧 [REGISTER] About to send verification email...`);
    try {
      await sendVerificationEmail(user.email, verificationCode, user.username);
      console.log(`✅ [REGISTER] Verification email sent successfully`);
    } catch (emailError) {
      console.error(`❌ [REGISTER] Email send failed:`, emailError.message);
      console.warn(`⚠️ [REGISTER] User registered but email could not be sent`);
    }

    const token = createToken(user._id);

    console.log(`🔐 [REGISTER] ═══════════════════════════════════\n`);

    res.status(201).json({
      success: true,
      message: "User registered successfully. Check your email to verify.",
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        profileImage: user.profileImage,
        accountId: account._id,
        profileCompleted: false,
        emailVerified: false,
      },
      account: {
        _id: account._id,
        accountNumber,
        balance: account.balance,
        currency: account.currency,
        status: account.status,
        verificationLevel: account.verificationLevel,
        requiresSetup: true,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error(`❌ [REGISTER] Registration error:`, error.message);
    console.error(`🔐 [REGISTER] ═══════════════════════════════════\n`);

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

// ✅ VERIFY EMAIL ENDPOINT
router.post("/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and code are required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+verificationCode +verificationCodeExpiresAt"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    if (!user.verificationCode) {
      return res.status(400).json({
        success: false,
        message: "No verification code found. Please request a new one.",
      });
    }

    if (new Date() > user.verificationCodeExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired. Please request a new one.",
      });
    }

    if (user.verificationCode !== code.toString()) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    // ✅ Mark email as verified
    user.emailVerified = true;
    user.verificationCode = null;
    user.verificationCodeExpiresAt = null;
    await user.save();

    console.log(`✅ Email verified for:`, user.email);

    res.status(200).json({
      success: true,
      message: "Email verified successfully",
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        emailVerified: true,
      },
    });
  } catch (error) {
    console.error(`❌ Email verification error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Email verification failed",
    });
  }
});

// ✅ RESEND VERIFICATION CODE ENDPOINT - WITH DEBUG
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;

    console.log("\n🔄 [RESEND] ═══════════════════════════════════");
    console.log(`🔄 [RESEND] Resend verification request`);
    console.log(`   Email: ${email}`);

    if (!email) {
      console.warn(`⚠️ [RESEND] No email provided`);
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      console.warn(`⚠️ [RESEND] User not found: ${email}`);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.emailVerified) {
      console.warn(`⚠️ [RESEND] Email already verified: ${email}`);
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    console.log(`🔐 [RESEND] Found user: ${user.username}`);

    // Generate new code
    const verificationCode = generateVerificationCode();
    const verificationCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    console.log(`🔐 [RESEND] Generated new code: ${verificationCode}`);

    user.verificationCode = verificationCode;
    user.verificationCodeExpiresAt = verificationCodeExpiresAt;
    await user.save();

    console.log(`💾 [RESEND] Code saved to database`);

    // Send email - WITH DEBUG
    console.log(`📧 [RESEND] About to send verification email...`);
    try {
      await sendVerificationEmail(user.email, verificationCode, user.username);
      console.log(`✅ [RESEND] Verification email sent successfully`);
    } catch (emailError) {
      console.error(`❌ [RESEND] Email send failed:`, emailError.message);
      console.error(`   Continuing anyway...`);
    }

    console.log(`🔄 [RESEND] ═══════════════════════════════════\n`);

    res.status(200).json({
      success: true,
      message: "Verification code resent to email",
    });
  } catch (error) {
    console.error(`❌ [RESEND] Error:`, error.message);
    console.error(`🔄 [RESEND] ═══════════════════════════════════\n`);

    res.status(500).json({
      success: false,
      message: error.message || "Failed to resend verification code",
    });
  }
});

// ✅ LOGIN ROUTE
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const account = await Account.findOne({ userId: user._id });

    if (!account) {
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

    user.lastLoginAt = new Date();
    await user.save();

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
        emailVerified: user.emailVerified,
      },
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
    console.error(`❌ Login error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
});

// ✅ GET CURRENT USER ROUTE
router.get("/me", protectRoute, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

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
