const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');

dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/bitetrack";

async function run() {
  try {
    await mongoose.connect(mongoUri);
    console.log("✅ Database connected.");

    const user = await User.findOne({ 
      pushToken: { $exists: true, $ne: "", $ne: null } 
    });
    if (!user) {
      console.log("❌ No user found with a registered pushToken. Please toggle 'Push Notifications' on in the app Hub first!");
      process.exit(1);
    }

    console.log(`📡 Sending test push notification to user: ${user.name} (${user.email})`);
    console.log(`🔑 Push Token: ${user.pushToken}`);

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        to: user.pushToken,
        title: "🚀 Server Push Active!",
        body: "BiteTrack server-sent push notifications are working perfectly!",
        sound: "default",
      }),
    });

    const result = await response.json();
    console.log("✅ Expo response:", JSON.stringify(result, null, 2));

  } catch (err) {
    console.error("❌ Error sending push:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
