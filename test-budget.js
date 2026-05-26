require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Budget = require('./models/Budget');
const FoodLog = require('./models/FoodLog');
const { sendEmail } = require('./utils/email');

async function debugBudget() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const latestUser = await User.findOne({ email: "batra.akshat25@gmail.com" });
  if (!latestUser) {
    console.log("Could not find batra.akshat25@gmail.com. Looking for latest user...");
    const fallback = await User.findOne().sort({ _id: -1 });
    if (!fallback) return process.exit(0);
    return await debugUser(fallback);
  }
  
  await debugUser(latestUser);
}

async function debugUser(user) {
  console.log(`\n======================================`);
  console.log(`Testing user: ${user.email} (ID: ${user._id})`);
  
  const now = new Date();
  const year = now.getFullYear();
  const monthZeroIndexed = now.getMonth();
  const month1Indexed = monthZeroIndexed + 1;

  let budget = await Budget.findOne({ userId: user._id, month: monthZeroIndexed, year });
  if (!budget) {
    budget = await Budget.findOne({ userId: user._id, saveForAllMonths: true }).sort({ createdAt: -1 });
  }

  if (!budget) {
    console.log("❌ No budget found for this user!");
    return process.exit(0);
  }
  
  console.log(`✅ Found budget: ${budget.amount}`);

  const startDate = new Date(year, monthZeroIndexed, 1);
  const endDate = new Date(year, monthZeroIndexed + 1, 0, 23, 59, 59, 999);
  
  const allLogsThisMonth = await FoodLog.find({
    user: user._id,
    date: { $gte: startDate, $lte: endDate }
  });

  const totalSpent = allLogsThisMonth.reduce((acc, log) => acc + (Number(log.amount) || 0), 0);
  console.log(`✅ Total spent this month: ${totalSpent}`);
  console.log(`✅ Threshold (70%): ${budget.amount * 0.7}`);

  if (totalSpent >= budget.amount * 0.7) {
    console.log("🚀 ALERT TRIGGERED! Sending email...");
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Budget Alert for ${month1Indexed}/${year}! 🚨</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>You have spent <strong>$${totalSpent.toFixed(2)}</strong> this month, which is over 70% of your monthly budget of <strong>$${budget.amount}</strong>.</p>
        <p>Keep an eye on your expenses!</p>
      </div>
    `;
    const success = await sendEmail(user.email, 'BiteTrack: You are approaching your monthly budget limit', html);
    if (success) {
      console.log("✅ Email sent successfully!");
    } else {
      console.log("❌ Email failed to send!");
    }
  } else {
    console.log("ℹ️ Under 70%. No alert.");
  }
  
  process.exit(0);
}

debugBudget().catch(console.error);
