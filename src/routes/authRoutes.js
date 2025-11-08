// =============== routes/authRoutes.js ===============

import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/user.js";
import jwt from "jsonwebtoken";
import protectRoute from "../middleware/authmiddleware.js";

const router = express.Router();

// ✅ Create JWT token
const createToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

// ✅ Validate email format
const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

// ✅ Register Route
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // ✅ Validate inputs
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // ✅ Validate username
    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({
        success: false,
        message: "Username must be between 3 and 30 characters",
      });
    }

    // ✅ Validate email format
    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // ✅ Validate password
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    // ✅ Check if email exists
    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: "Email already in use",
      });
    }

    // ✅ Check if username exists
    const existingUsername = await User.findOne({
      username: username.toLowerCase(),
    });
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: "Username already in use",
      });
    }

    // ✅ Generate profile image
    const profileImage = `https://api.dicebear.com/6.x/initials/svg?seed=${username}`;

    // ✅ Create user
    const user = new User({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      profileImage,
    });

    await user.save();

    // ✅ Create token
    const token = createToken(user._id);

    console.log(`[${req.id}] ✅ User registered:`, user.email);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        profileImage: user.profileImage,
      },
    });
  } catch (error) {
    console.error(`[${req.id}] ❌ Registration error:`, error.message);

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

    // ✅ Update last login
    user.lastLoginAt = new Date();
    await user.save();

    // ✅ Create token
    const token = createToken(user._id);

    console.log(`[${req.id}] ✅ User logged in:`, user.email);

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
    });
  } catch (error) {
    console.error(`[${req.id}] ❌ Login error:`, error.message);
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

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error(`[${req.id}] ❌ Get user error:`, error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
});

export default router;
