// ================== lib/emailTest.js ==================
import nodemailer from "nodemailer";
import "dotenv/config";

console.log("🔍 [EMAIL TEST] Starting Brevo configuration test...\n");

// ✅ Check environment variables
console.log("📋 [ENV CHECK] Checking environment variables:");
console.log(
  `   - SMTP_USER: ${process.env.SMTP_USER ? "✅ SET" : "❌ MISSING"}`
);
console.log(
  `   - SMTP_PASS: ${process.env.SMTP_PASS ? "✅ SET" : "❌ MISSING"}`
);
console.log(
  `   - SENDER_EMAIL: ${process.env.SENDER_EMAIL ? "✅ SET" : "❌ MISSING"}`
);
console.log(`   - SMTP_USER value: ${process.env.SMTP_USER}`);
console.log(`   - SENDER_EMAIL value: ${process.env.SENDER_EMAIL}\n`);

// ✅ Create transporter
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false, // Use TLS, not SSL
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  logger: true, // Enable logging
  debug: true, // Enable debug mode
});

// ✅ Test connection
console.log("🔗 [CONNECTION TEST] Verifying transporter connection...");
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ [CONNECTION FAILED]");
    console.error("   Error:", error.message);
    console.error("   Code:", error.code);
    console.error("   Command:", error.command);
    process.exit(1);
  } else {
    console.log("✅ [CONNECTION SUCCESS] SMTP connection is ready!\n");

    // ✅ Send test email
    sendTestEmail();
  }
});

// ✅ Send test email
const sendTestEmail = async () => {
  try {
    console.log("📧 [SEND TEST] Preparing test email...");

    const testEmail = {
      from: process.env.SENDER_EMAIL,
      to: process.env.SENDER_EMAIL, // Send to yourself
      subject: "🧪 Tasktuges Email Test",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #667eea; padding: 20px; border-radius: 5px; text-align: center;">
            <h1 style="color: white; margin: 0;">Email Test Successful! 🎉</h1>
          </div>
          <div style="padding: 20px; background: #f5f5f5;">
            <p>This is a test email from Tasktuges.</p>
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
            <p><strong>From:</strong> ${process.env.SENDER_EMAIL}</p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              If you received this, Brevo is working correctly! ✅
            </p>
          </div>
        </div>
      `,
    };

    console.log(`   - From: ${testEmail.from}`);
    console.log(`   - To: ${testEmail.to}`);
    console.log(`   - Subject: ${testEmail.subject}`);

    const info = await transporter.sendMail(testEmail);

    console.log("\n✅ [SEND SUCCESS] Email sent successfully!");
    console.log("   Message ID:", info.messageId);
    console.log("   Response:", info.response);
    console.log("   Accepted:", info.accepted);
    console.log("\n📧 Check your inbox at:", process.env.SENDER_EMAIL);

    process.exit(0);
  } catch (error) {
    console.error("\n❌ [SEND FAILED] Failed to send email");
    console.error("   Error:", error.message);
    console.error("   Code:", error.code);
    console.error("   Command:", error.command);
    console.error("   Response:", error.response);

    process.exit(1);
  }
};

// ✅ Handle timeout
setTimeout(() => {
  console.error("\n❌ [TIMEOUT] Test timed out after 30 seconds");
  process.exit(1);
}, 30000);
