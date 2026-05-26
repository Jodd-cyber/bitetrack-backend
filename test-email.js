require('dotenv').config();
const { sendEmail } = require('./utils/email');

async function runTest() {
  const testEmail = process.env.EMAIL_USER;
  console.log(`\n--- Starting Email Test ---`);
  console.log(`Attempting to send test email to: ${testEmail}`);
  
  if (!testEmail || !process.env.EMAIL_PASS) {
    console.error("❌ ERROR: EMAIL_USER or EMAIL_PASS is missing in .env file");
    return;
  }

  try {
    const success = await sendEmail(
      testEmail, 
      "Test Email from BiteTrack Server", 
      "<h1>It works! 🚀</h1><p>If you are reading this, your Gmail App Password and Nodemailer are perfectly configured.</p>"
    );
    
    if (success) {
      console.log("✅ SUCCESS: Email sent successfully! Check your inbox.");
    } else {
      console.log("❌ FAILED: sendEmail returned false. Look at the error logs above.");
    }
  } catch (err) {
    console.error("❌ ERROR: Caught an exception:", err);
  }
  console.log(`---------------------------\n`);
}

runTest();
