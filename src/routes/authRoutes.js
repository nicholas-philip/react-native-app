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
// Note: SMTP_USER should be the FULL login like: 890bb6001@smtp-brevo.com
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10000,
  socketTimeout: 15000,
  pool: {
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 10,
  },
});

// Verify transporter on startup
transporter.verify((error, success) => {
  console.log("\n" + "═".repeat(100));
  console.log("🔌 [TRANSPORTER-INIT] Email Service Initialization");
  console.log("═".repeat(100));
  console.log(`   SMTP_USER: ${process.env.SMTP_USER || "❌ NOT SET"}`);
  console.log(`   SENDER_EMAIL: ${process.env.SENDER_EMAIL || "❌ NOT SET"}`);
  console.log(`   Host: smtp-relay.brevo.com`);
  console.log(`   Port: 587`);

  if (error) {
    console.log(`\n   ❌ TRANSPORTER ERROR:`);
    console.log(`      Message: ${error.message}`);
    console.log(`      Code: ${error.code}`);
    console.log(`      Command: ${error.command}`);
    console.log(`\n   ACTION REQUIRED: Check your Brevo credentials!`);
  } else {
    console.log(`\n   ✅ TRANSPORTER READY - Email service is working!`);
  }
  console.log("═".repeat(100) + "\n");
});

const createToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

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

const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

// ✅ SEND VERIFICATION EMAIL - DETAILED DEBUG LOGGING
const sendVerificationEmail = async (email, code, username) => {
  const startTime = Date.now();

  console.log("\n" + "═".repeat(100));
  console.log("📧 [EMAIL-SEND] Starting verification email process");
  console.log("═".repeat(100));
  console.log(`   To: ${email}`);
  console.log(`   Username: ${username}`);
  console.log(`   Code: ${code}`);
  console.log(`   From: ${process.env.SENDER_EMAIL}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);

  try {
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
            <p style="color: #333; font-size: 16px; margin: 0 0 20px 0;">Hi <strong>${username}</strong>,</p>
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0 0 30px 0;">Thank you for signing up! Please verify your email by entering this code:</p>
            <div style="background-color: #fff; padding: 30px; border-radius: 10px; border: 2px dashed #667eea; margin: 30px 0; text-align: center;">
              <p style="color: #999; font-size: 12px; margin: 0 0 10px 0; text-transform: uppercase;">Your verification code</p>
              <div style="font-size: 48px; font-weight: bold; color: #667eea; letter-spacing: 8px; margin: 15px 0; font-family: 'Courier New', monospace;">${code}</div>
              <p style="color: #999; font-size: 12px; margin: 15px 0 0 0;">Expires in 10 minutes</p>
            </div>
          </div>
        </div>
      `,
    };

    console.log(`   ✅ Mail options prepared`);
    console.log(`   📤 Attempting to send via nodemailer...`);

    // Create timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Email send timeout (20s)")), 20000)
    );

    // Send with timeout
    const emailPromise = transporter.sendMail(mailOptions);
    const info = await Promise.race([emailPromise, timeoutPromise]);

    const duration = Date.now() - startTime;

    console.log(`\n   ✅ EMAIL SENT SUCCESSFULLY!`);
    console.log(`      Message ID: ${info.messageId}`);
    console.log(`      Response: ${info.response}`);
    console.log(`      Accepted: ${JSON.stringify(info.accepted)}`);
    console.log(`      Duration: ${duration}ms`);
    console.log("═".repeat(100) + "\n");

    return true;
  } catch (error) {
    const duration = Date.now() - startTime;

    console.log(`\n   ❌ EMAIL SEND FAILED!`);
    console.log(`      Error Name: ${error.name}`);
    console.log(`      Error Message: ${error.message}`);
    console.log(`      Error Code: ${error.code}`);
    console.log(`      Error Command: ${error.command}`);
    console.log(`      Duration: ${duration}ms`);
    console.log(`\n   DEBUGGING INFO:`);
    console.log(`      Transporter Host: ${transporter.options?.host}`);
    console.log(`      Transporter Port: ${transporter.options?.port}`);
    console.log(
      `      Transporter Auth User: ${transporter.options?.auth?.user}`
    );
    console.log(`      Full Error:`, error);
    console.log("═".repeat(100) + "\n");

    throw error;
  }
};

// ✅ REGISTER ROUTE
router.post("/register", async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { username, email, password } = req.body;

    console.log("\n🔐 [REGISTER] New registration attempt");
    console.log(`   Username: ${username}`);
    console.log(`   Email: ${email}`);

    if (!username || !email || !password) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (username.length < 3 || username.length > 30) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Username must be between 3 and 30 characters",
      });
    }

    if (!validateEmail(email)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    if (password.length < 6) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

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

    // ✅ FIX: Encode username for URL
    const profileImage = `https://api.dicebear.com/6.x/initials/svg?seed=${encodeURIComponent(
      username
    )}`;
    const verificationCode = generateVerificationCode();
    const verificationCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    console.log(`   Generated code: ${verificationCode}`);
    console.log(`   Profile image URL: ${profileImage}`);

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
    console.log(`   ✅ User created in DB`);

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
    console.log(`   ✅ Account created`);

    user.accountId = account._id;
    await user.save({ session });

    await session.commitTransaction();
    console.log(`   ✅ Transaction committed`);

    const token = createToken(user._id);

    console.log(`   📤 Sending response to client...`);

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

    console.log(`   ✅ Response sent\n`);
    console.log(`🔄 NOW SENDING VERIFICATION EMAIL IN BACKGROUND...\n`);

    sendVerificationEmail(user.email, verificationCode, user.username)
      .then(() => {
        console.log(
          `✅ [REGISTER-BACKGROUND] Email task completed successfully\n`
        );
      })
      .catch((emailError) => {
        console.log(`\n❌ [REGISTER-BACKGROUND] Email task failed!`);
        console.log(`   Error: ${emailError.message}\n`);
      });
  } catch (error) {
    await session.abortTransaction();
    console.error(`❌ [REGISTER] Registration error:`, error.message);

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

// ✅ VERIFY EMAIL
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

    user.emailVerified = true;
    user.verificationCode = null;
    user.verificationCodeExpiresAt = null;
    await user.save();

    console.log(`✅ [VERIFY] Email verified for: ${user.email}`);

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
    console.error(`❌ [VERIFY] Error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Email verification failed",
    });
  }
});

// ✅ RESEND VERIFICATION CODE
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;

    console.log("\n🔄 [RESEND] Resend verification request");
    console.log(`   Email: ${email}`);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      console.warn(`   ⚠️ User not found`);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.emailVerified) {
      console.warn(`   ⚠️ Email already verified`);
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    const verificationCode = generateVerificationCode();
    const verificationCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    console.log(`   Generated new code: ${verificationCode}`);

    user.verificationCode = verificationCode;
    user.verificationCodeExpiresAt = verificationCodeExpiresAt;
    await user.save();

    console.log(`   ✅ Code saved to DB`);
    console.log(`   📤 Sending response to client...`);

    res.status(200).json({
      success: true,
      message: "Verification code resent to email",
    });

    console.log(`   ✅ Response sent\n`);
    console.log(`🔄 NOW SENDING VERIFICATION EMAIL IN BACKGROUND...\n`);

    sendVerificationEmail(user.email, verificationCode, user.username)
      .then(() => {
        console.log(
          `✅ [RESEND-BACKGROUND] Email task completed successfully\n`
        );
      })
      .catch((emailError) => {
        console.log(`\n❌ [RESEND-BACKGROUND] Email task failed!`);
        console.log(`   Error: ${emailError.message}\n`);
      });
  } catch (error) {
    console.error(`❌ [RESEND] Error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to resend verification code",
    });
  }
});

// ✅ LOGIN
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

    console.log(`✅ [LOGIN] User logged in: ${user.email}`);

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
    console.error(`❌ [LOGIN] Error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
});

// ✅ GET CURRENT USER
router.get("/me", protectRoute, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        user,
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
    console.error(`❌ [GET-ME] Error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
});

export default router;
