// =============== utils/helpers.js (UPDATED - FIXED GHANA PHONE VALIDATION) ===============
import crypto from "crypto";

// ✅ ENCRYPTION/DECRYPTION for PII
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
const ENCRYPTION_IV = process.env.ENCRYPTION_IV || crypto.randomBytes(16);

export const encryptSensitiveData = (data) => {
  if (!data) return null;
  try {
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      Buffer.from(ENCRYPTION_KEY),
      Buffer.from(ENCRYPTION_IV)
    );
    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
  } catch (err) {
    console.error("❌ Encryption error:", err.message);
    throw new Error("Failed to encrypt data");
  }
};

export const decryptSensitiveData = (encryptedData) => {
  if (!encryptedData) return null;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(ENCRYPTION_KEY),
      Buffer.from(ENCRYPTION_IV)
    );
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("❌ Decryption error:", err.message);
    throw new Error("Failed to decrypt data");
  }
};

// ✅ AMOUNT VALIDATION
export const validateAmount = (amount) => {
  const MIN_AMOUNT = 0.01;
  const MAX_AMOUNT = 100000;

  if (!amount || typeof amount !== "number") {
    return {
      valid: false,
      error: "Amount must be a valid number",
    };
  }

  if (amount < MIN_AMOUNT) {
    return {
      valid: false,
      error: `Amount must be at least ${MIN_AMOUNT}`,
    };
  }

  if (amount > MAX_AMOUNT) {
    return {
      valid: false,
      error: `Amount cannot exceed ${MAX_AMOUNT}`,
    };
  }

  // Check decimal places
  if (!/^\d+(\.\d{1,2})?$/.test(amount.toString())) {
    return {
      valid: false,
      error: "Amount can have maximum 2 decimal places",
    };
  }

  return {
    valid: true,
    amount: parseFloat(amount.toFixed(2)),
  };
};

// ✅ FIXED PHONE NUMBER VALIDATION for Ghana networks
export const validatePhoneNumber = (phoneNumber) => {
  if (!phoneNumber || typeof phoneNumber !== "string") {
    return {
      valid: false,
      error: "Phone number is required",
    };
  }

  // Remove spaces, dashes, and parentheses
  const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, "");

  // Ghana phone formats:
  // Local: 0XXXXXXXXX
  // International: +233XXXXXXXXX or 233XXXXXXXXX
  const ghanaPhoneRegex =
    /^(?:\+?233|0)(?:20|23|24|25|26|27|28|29|50|54|55|56|57|58|59)\d{6}$/;

  if (!ghanaPhoneRegex.test(cleaned)) {
    return {
      valid: false,
      error: "Invalid Ghana phone number format",
    };
  }

  // Normalize to +233 format
  let formatted = cleaned;
  if (formatted.startsWith("0")) {
    formatted = "+233" + formatted.substring(1);
  } else if (formatted.startsWith("233")) {
    formatted = "+" + formatted;
  }

  return {
    valid: true,
    phoneNumber: formatted,
  };
};

// ✅ ACCOUNT NUMBER VALIDATION
export const validateAccountNumber = (accountNumber) => {
  if (!accountNumber || typeof accountNumber !== "string") {
    return {
      valid: false,
      error: "Account number is required",
    };
  }

  // Account numbers should be 10 digits
  const accountRegex = /^\d{10}$/;

  if (!accountRegex.test(accountNumber)) {
    return {
      valid: false,
      error: "Invalid account number format",
    };
  }

  return {
    valid: true,
    accountNumber,
  };
};

// ✅ EMAIL VALIDATION
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// ✅ STRING SANITIZATION (prevent XSS)
export const sanitizeString = (str, maxLength = 500) => {
  if (!str || typeof str !== "string") return "";

  // Remove HTML tags and dangerous characters
  let sanitized = str
    .replace(/<[^>]*>/g, "")
    .replace(/[<>"'&]/g, (char) => {
      const entities = {
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#x27;",
        "&": "&amp;",
      };
      return entities[char];
    })
    .trim();

  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
};

// ✅ REFERENCE GENERATION
export const generateReference = (type) => {
  const typeMap = {
    deposit: "DEP",
    withdrawal: "WDR",
    transfer: "TRF",
    payment: "PAY",
  };
  return (
    (typeMap[type] || "TXN") +
    Date.now() +
    Math.random().toString(36).substr(2, 9).toUpperCase()
  );
};

// ✅ IDEMPOTENCY KEY VALIDATION
export const validateIdempotencyKey = (key) => {
  if (!key) return false;
  return /^[a-f0-9\-]{36}$|^[a-zA-Z0-9\-_]{20,}$/.test(key);
};

// ✅ NETWORK VALIDATION (MTN, VODAFONE, TIGO)
export const validateNetwork = (network) => {
  const validNetworks = ["MTN", "VODAFONE", "TIGO"];
  return validNetworks.includes(network?.toUpperCase());
};

// ✅ ACCOUNT STATUS VALIDATION
export const validateAccountStatus = (status) => {
  const validStatuses = ["active", "frozen", "closed"];
  return validStatuses.includes(status?.toLowerCase());
};

// ✅ PAYMENT METHOD VALIDATION
export const validatePaymentMethod = (method) => {
  const validMethods = ["wallet", "card", "transfer", "mobile_money"];
  return validMethods.includes(method?.toLowerCase());
};

// ✅ TRANSACTION TYPE VALIDATION
export const validateTransactionType = (type) => {
  const validTypes = [
    "deposit",
    "withdrawal",
    "transfer_in",
    "transfer_out",
    "payment",
  ];
  return validTypes.includes(type?.toLowerCase());
};

// ✅ DATE VALIDATION
export const validateDateOfBirth = (date) => {
  const dob = new Date(date);
  const today = new Date();
  const age = today.getFullYear() - dob.getFullYear();

  if (age < 18) {
    return {
      valid: false,
      error: "Must be at least 18 years old",
    };
  }

  if (age > 150) {
    return {
      valid: false,
      error: "Invalid date of birth",
    };
  }

  return {
    valid: true,
    dateOfBirth: dob,
  };
};

// ✅ SIMPLIFIED ID NUMBER VALIDATION
export const validateIdNumber = (idNumber, idType) => {
  if (!idNumber || typeof idNumber !== "string") {
    return {
      valid: false,
      error: "ID number is required",
    };
  }

  const cleaned = idNumber.trim();

  if (cleaned.length < 5) {
    return {
      valid: false,
      error: "ID number must be at least 5 characters",
    };
  }

  if (cleaned.length > 50) {
    return {
      valid: false,
      error: "ID number cannot exceed 50 characters",
    };
  }

  if (!/^[A-Za-z0-9\s\-]+$/.test(cleaned)) {
    return {
      valid: false,
      error: "ID number can only contain letters, numbers, spaces, and dashes",
    };
  }

  return {
    valid: true,
    idNumber: cleaned,
  };
};

// ✅ MONTH/YEAR VALIDATION
export const validateMonthYear = (month, year) => {
  if (!month || !year) {
    return {
      valid: false,
      error: "Month and year are required",
    };
  }

  const m = parseInt(month);
  const y = parseInt(year);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (m < 1 || m > 12) {
    return {
      valid: false,
      error: "Invalid month",
    };
  }

  if (y < currentYear || (y === currentYear && m < currentMonth)) {
    return {
      valid: false,
      error: "Card has expired",
    };
  }

  return {
    valid: true,
    month: m,
    year: y,
  };
};

// ✅ PAGINATION VALIDATION
export const validatePagination = (page, limit) => {
  const validPage = Math.max(parseInt(page) || 1, 1);
  const validLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);

  return {
    page: validPage,
    limit: validLimit,
    skip: (validPage - 1) * validLimit,
  };
};

// ✅ STATUS MESSAGE
export const getStatusMessage = (statusCode) => {
  const messages = {
    400: "Bad request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not found",
    409: "Conflict",
    500: "Internal server error",
  };
  return messages[statusCode] || "Error";
};

// ✅ LOG UTILITY
export const logTransaction = (requestId, message, data = {}) => {
  console.log(`[${requestId}] ${message}`, data);
};

export default {
  encryptSensitiveData,
  decryptSensitiveData,
  validateAmount,
  validatePhoneNumber,
  validateAccountNumber,
  validateEmail,
  sanitizeString,
  generateReference,
  validateIdempotencyKey,
  validateNetwork,
  validateAccountStatus,
  validatePaymentMethod,
  validateTransactionType,
  validateDateOfBirth,
  validateIdNumber,
  validateMonthYear,
  validatePagination,
  getStatusMessage,
  logTransaction,
};
