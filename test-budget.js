require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Budget = require('./models/Budget');
const FoodLog = require('./models/FoodLog');

async function testBudgetCheck() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  // Get the most recently created user
  const latestUser = await User.findOne().sort({ _id: -1 });
  if (!latestUser) {
    console.log("No user found.");
    process.exit(0);
  }

  console.log(`Testing for user: ${latestUser.email} (ID: ${latestUser._id})`);
  console.log(`lastBudgetAlertMonth: ${latestUser.lastBudgetAlertMonth}`);

  const now = new Date();
  const year = now.getFullYear();
  const monthZeroIndexed = now.getMonth();

  let budget = await Budget.findOne({ userId: latestUser._id, month: monthZeroIndexed, year });
  if (!budget) {
    console.log("No exact month budget found, checking carry-over...");
    budget = await Budget.findOne({ userId: latestUser._id, saveForAllMonths: true }).sort({ createdAt: -1 });
  }

  if (!budget) {
    console.log("No budget found at all for this user.");
    process.exit(0);
  }

  console.log(`Found budget: ${budget.amount}`);

  const startDate = new Date(year, monthZeroIndexed, 1);
  const endDate = new Date(year, monthZeroIndexed + 1, 0, 23, 59, 59, 999);
  
  const allLogsThisMonth = await FoodLog.find({
    user: latestUser._id,
    date: { $gte: startDate, $lte: endDate }
  });

  const totalSpent = allLogsThisMonth.reduce((acc, log) => acc + (Number(log.amount) || 0), 0);
  console.log(`Total spent this month: ${totalSpent} (Logs count: ${allLogsThisMonth.length})`);
  console.log(`Threshold (70%): ${budget.amount * 0.7}`);

  if (totalSpent >= budget.amount * 0.7) {
    console.log("ALERT WOULD TRIGGER! Over 70%.");
  } else {
    console.log("No alert. Under 70%.");
  }

  process.exit(0);
}

testBudgetCheck().catch(console.error);
