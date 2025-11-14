// ================== lib/emailDiagnostic.js ==================
import nodemailer from "nodemailer";
import "dotenv/config";

console.log("\n🔍 [BREVO DIAGNOSTIC] Starting comprehensive test...\n");

// ✅ Display environment variables (masked)
console.log("📋 [ENV CHECK] Environment Variables:");
const smtpUser = process.env.SMTP_USER || "NOT SET";
const smtpPass = process.env.SMTP_PASS || "NOT SET";
const senderEmail = process.env.SENDER_EMAIL || "NOT SET";

console.log(`   - SMTP_USER: ${smtpUser ? "✅ " + smtpUser : "❌ MISSING"}`);
console.log(
  `   - SMTP_PASS: ${
    smtpPass
      ? `✅ ${smtpPass.substring(0, 3)}***${smtpPass.substring(
          smtpPass.length - 3
        )}`
      : "❌ MISSING"
  }`
);
console.log(
  `   - SENDER_EMAIL: ${senderEmail ? "✅ " + senderEmail : "❌ MISSING"}\n`
);

// ✅ Test both credential formats
const testConfigs = [
  {
    name: "Format 1: With @smtp-brevo.com",
    config: {
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    },
  },
  {
    name: "Format 2: Without @smtp-brevo.com",
    config: {
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: {
        user: smtpUser.replace("@smtp-brevo.com", ""),
        pass: smtpPass,
      },
    },
  },
];

async function testConfig(name, config) {
  console.log(`\n🧪 [TEST] ${name}`);
  console.log(`   User: ${config.auth.user}`);

  const transporter = nodemailer.createTransport(config);

  try {
    await transporter.verify();
    console.log(`   ✅ SUCCESS! This format works!\n`);
    return { success: true, transporter, config };
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}`);
    if (error.code) console.log(`   Code: ${error.code}`);
    if (error.command) console.log(`   Command: ${error.command}`);
    return { success: false, error };
  }
}

async function runDiagnostic() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 TESTING BOTH CREDENTIAL FORMATS");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let workingConfig = null;

  for (const test of testConfigs) {
    const result = await testConfig(test.name, test.config);
    if (result.success) {
      workingConfig = result;
      break;
    }
  }

  if (!workingConfig) {
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("❌ BOTH FORMATS FAILED - ACTION REQUIRED");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("🔧 TROUBLESHOOTING STEPS:\n");
    console.log("1. Go to Brevo: https://app.brevo.com/settings/keys/smtp");
    console.log("2. Click 'Generate new SMTP key' or 'Reset password'");
    console.log("3. Copy the EXACT credentials shown");
    console.log("4. Update your .env file with new credentials");
    console.log(
      "5. Verify sender email at: https://app.brevo.com/settings/senders\n"
    );

    console.log("📧 VERIFY YOUR SENDER EMAIL:");
    console.log(`   Current: ${senderEmail}`);
    console.log("   Must have green checkmark in Brevo dashboard\n");

    console.log("🔍 COMMON ISSUES:");
    console.log("   • Wrong password (Brevo passwords are case-sensitive)");
    console.log("   • Unverified sender email");
    console.log("   • Account suspended or limited");
    console.log("   • Old/expired SMTP credentials\n");

    process.exit(1);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ AUTHENTICATION SUCCESS!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("📝 USE THIS CONFIGURATION IN YOUR .env:\n");
  console.log(`SMTP_USER=${workingConfig.config.auth.user}`);
  console.log(`SMTP_PASS=${smtpPass}`);
  console.log(`SENDER_EMAIL=${senderEmail}\n`);

  // Send test email
  console.log("📧 [SENDING TEST EMAIL] ...\n");

  try {
    const mailOptions = {
      from: senderEmail,
      to: "philiplodonu67@gmail.com",
      subject: "✅ Tasktuges Email Working!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">🎉 SUCCESS!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">Your Brevo email is working</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 40px 20px; border-radius: 0 0 10px 10px;">
            <p style="color: #333; font-size: 16px;">Your Tasktuges verification emails will now be delivered successfully!</p>
            
            <div style="background: white; padding: 30px; border-radius: 10px; border: 2px dashed #667eea; margin: 30px 0; text-align: center;">
              <p style="color: #999; font-size: 12px; text-transform: uppercase; margin: 0 0 15px;">Sample Verification Code</p>
              <div style="font-size: 48px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                123456
              </div>
            </div>

            <p style="color: #666; font-size: 13px;">
              <strong>Configuration Used:</strong><br>
              Username: ${workingConfig.config.auth.user}<br>
              Sender: ${senderEmail}<br>
              Time: ${new Date().toISOString()}
            </p>
            
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="color: #999; font-size: 11px; text-align: center;">© 2024 Tasktuges</p>
          </div>
        </div>
      `,
    };

    const info = await workingConfig.transporter.sendMail(mailOptions);

    console.log("✅ TEST EMAIL SENT SUCCESSFULLY!");
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Accepted: ${info.accepted}`);
    console.log(`\n📬 Check your inbox: philiplodonu67@gmail.com`);
    console.log("   (Also check spam folder)\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to send test email:");
    console.error(`   ${error.message}\n`);
    process.exit(1);
  }
}

// Add timeout
setTimeout(() => {
  console.error("\n⏱️ Test timed out after 30 seconds\n");
  process.exit(1);
}, 30000);

runDiagnostic();
