require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const { sendEmail } = require('./utils/email');

async function directTest() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  // Fetch the specific user
  const user = await User.findOne({ email: "batraakshat68@gmail.com" });
  
  if (!user) {
    console.log("User batraakshat68@gmail.com not found in DB!");
    process.exit(0);
  }
  
  console.log(`Found user: ${user.email}. Attempting to force-send an email right now...`);
  
  const success = await sendEmail(
    user.email, 
    "Manual Override Test - BiteTrack", 
    "<h1>Manual Test!</h1><p>If you see this, the server successfully pushed an email to batraakshat68@gmail.com.</p>"
  );
  
  if (success) {
    console.log("✅ Email successfully sent out by Nodemailer!");
  } else {
    console.log("❌ Nodemailer failed to send the email.");
  }
  
  process.exit(0);
}

directTest().catch(console.error);
