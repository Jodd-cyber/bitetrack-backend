const cron = require('node-cron');
const User = require('../models/User');
const FoodLog = require('../models/FoodLog');
const { sendEmail } = require('./email');

// Run every day at 8:00 PM (20:00) server time
// "0 20 * * *"
cron.schedule('0 20 * * *', async () => {
  console.log('Running daily reminder check...');
  try {
    const users = await User.find({ remindersEnabled: { $ne: false } });
    
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    for (const user of users) {
      if (!user.email) continue;
      
      const logsToday = await FoodLog.countDocuments({
        user: user._id,
        date: { $gte: todayStart, $lte: todayEnd }
      });

      if (logsToday === 0) {
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2>Hey ${user.name || 'there'}! 👋</h2>
            <p>We noticed you haven't logged any meals in BiteTrack today.</p>
            <p>Keeping track daily is the best way to stay on top of your budget and goals.</p>
            <p>
              <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Log Your Meals Now</a>
            </p>
            <br>
            <small style="color: #777;">You can turn off these daily reminders in your profile settings anytime.</small>
          </div>
        `;
        await sendEmail(user.email, 'Don\'t forget to log your meals today!', html);
      }
    }
    console.log('Daily reminder check finished.');
  } catch (error) {
    console.error('Error running daily cron job:', error);
  }
});
