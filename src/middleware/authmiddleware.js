// =============== middleware/auth.js ===============

import jwt from "jsonwebtoken";
import User from "../models/user.js";

const protectRoute = async (req, res, next) => {
  try {
    // ✅ Get token from header
    const authHeader = req.header("Authorization");
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No authentication token provided",
      });
    }

    // ✅ Extract token (remove "Bearer " prefix)
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Invalid token format. Use: Bearer <token>",
      });
    }

    // ✅ Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Token has expired",
        });
      }
      if (error.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          message: "Invalid token",
        });
      }
      throw error;
    }

    // ✅ Find user
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found or token is invalid",
      });
    }

    // ✅ Attach user to request
    req.user = user;
    next();
  } catch (error) {
    console.error(`[${req.id}] ❌ Authentication error:`, error.message);
    res.status(401).json({
      success: false,
      message: "Authentication failed",
    });
  }
};

export default protectRoute;
