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

// ✅ PHONE NUMBER VALIDATION for Ghana networks
export const validatePhoneNumber = (phoneNumber) => {
  if (!phoneNumber || typeof phoneNumber !== "string") {
    return {
      valid: false,
      error: "Phone number is required",
    };
  }

  // Remove spaces and dashes
  const cleaned = phoneNumber.replace(/[\s\-]/g, "");

  // Ghana phone numbers: +233XXXXXXXXX or 0XXXXXXXXX
  const ghanaPhoneRegex = /^(?:\+233|0)(?:2[0-4]|5[0-9]|9[0-9])\d{7}$/;

  if (!ghanaPhoneRegex.test(cleaned)) {
    return {
      valid: false,
      error: "Invalid Ghana phone number format",
    };
  }

  return {
    valid: true,
    phoneNumber: cleaned,
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
    .replace(/<[^>]*>/g, "") // Remove HTML tags
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

  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
};

// ✅ REFERENCE GENERATION (with timestamp + random)
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
  // Idempotency key should be UUID format or similar
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

// ✅ ID NUMBER VALIDATION
export const validateIdNumber = (idNumber, idType) => {
  if (!idNumber || typeof idNumber !== "string") {
    return {
      valid: false,
      error: "ID number is required",
    };
  }

  // Remove spaces and dashes
  const cleaned = idNumber.replace(/[\s\-]/g, "");

  // Different validation based on ID type
  switch (idType?.toUpperCase()) {
    case "NATIONAL_ID":
      // Accept 9-13 digit National IDs (flexible for different formats)
      if (!/^\d{9,13}$/.test(cleaned)) {
        return {
          valid: false,
          error: "National ID must be 9-13 digits",
        };
      }
      break;

    case "PASSPORT":
      // Passport usually 6-9 alphanumeric
      if (!/^[A-Z0-9]{6,9}$/.test(cleaned)) {
        return {
          valid: false,
          error: "Invalid passport format (6-9 characters)",
        };
      }
      break;

    case "DRIVER_LICENSE":
      // Driver license varies, allow 5-20 alphanumeric
      if (!/^[A-Z0-9]{5,20}$/.test(cleaned)) {
        return {
          valid: false,
          error: "Invalid driver license format (5-20 characters)",
        };
      }
      break;

    default:
      return {
        valid: false,
        error: "Invalid ID type",
      };
  }

  return {
    valid: true,
    idNumber: cleaned,
  };
};

// ✅ MONTH/YEAR VALIDATION (for credit card expiry)
export const validateMonthYear = (month, year) => {
  if (!month || !year) {
    return {
      valid: false,
      error: "Month and year are required",
    };
  }

  const m = parseInt(month);
  const y = parseInt(year);

  if (m < 1 || m > 12) {
    return {
      valid: false,
      error: "Invalid month",
    };
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

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
  const validLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 100); // Max 100 per page

  return {
    page: validPage,
    limit: validLimit,
    skip: (validPage - 1) * validLimit,
  };
};

// ✅ HTTP STATUS CODE MESSAGE MAPPING
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

// ✅ LOG UTILITY (with request ID)
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
