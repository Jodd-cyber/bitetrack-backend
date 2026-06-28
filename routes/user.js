const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Budget = require('../models/Budget');
const FoodLog = require('../models/FoodLog');
const ChatSession = require('../models/ChatSession');

// Update monthly budget
router.put('/budget', auth, async (req, res) => {
  try {
    const { monthlyBudget } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { monthlyBudget },
      { new: true }
    );

    res.json(user);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating budget" });
  }
});
// Get user profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user.profile || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Update user profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { age, height, weight, gender, goal, avatar, aiAssistant } = req.body;
    const user = await User.findById(req.user.id);
    
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.profile) {
      user.profile = {};
    }

    if (age !== undefined) user.profile.age = age;
    if (height !== undefined) user.profile.height = height;
    if (weight !== undefined) user.profile.weight = weight;
    if (gender !== undefined) user.profile.gender = gender;
    if (goal !== undefined) user.profile.goal = goal;
    if (avatar !== undefined) user.profile.avatar = avatar;
    if (aiAssistant !== undefined) {
      user.profile.aiAssistant = {
        name: (aiAssistant.name && aiAssistant.name.trim()) ? aiAssistant.name.trim() : "AI Assistant",
        personality: aiAssistant.personality || "normal",
        orbTheme: aiAssistant.orbTheme || "emerald"
      };
    }

    await user.save();
    res.json(user.profile);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating profile" });
  }
});

// Delete user account and all associated data permanently
router.delete('/profile', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`⚠️ [User] Commencing permanent account deletion for User ID: ${userId}`);

    // 1. Delete associated budgets
    await Budget.deleteMany({ userId });

    // 2. Delete associated food logs
    await FoodLog.deleteMany({ user: userId });

    // 3. Delete associated chat sessions
    await ChatSession.deleteMany({ user: userId });

    // 4. Delete the User record itself
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({ message: "User account not found" });
    }

    console.log(`✅ [User] Successfully deleted user ID: ${userId} and all associated records.`);
    res.json({ success: true, message: "Your account and all associated logs have been permanently deleted." });

  } catch (err) {
    console.error("❌ [User] Account deletion crash:", err);
    res.status(500).json({ message: "Server error during account deletion. Try again later." });
  }
});

// Register or update user's push token
router.post('/push-token', auth, async (req, res) => {
  try {
    const { pushToken } = req.body;
    await User.findByIdAndUpdate(req.user.id, { pushToken });
    console.log(`📡 [Push] Registered token for user ${req.user.id}`);
    res.json({ success: true, message: "Push token registered successfully" });
  } catch (err) {
    console.error("❌ Register push token error:", err);
    res.status(500).json({ message: "Server error registering push token" });
  }
});

// Send a test push notification from backend
router.post('/send-push', auth, async (req, res) => {
  try {
    const { title, body } = req.body;
    const user = await User.findById(req.user.id);
    if (!user || !user.pushToken) {
      return res.status(400).json({ message: "User does not have a registered push token." });
    }

    console.log(`📡 [Push] Sending remote push alert to user: ${user.email}`);
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        to: user.pushToken,
        title: title || "🔔 BiteTrack Update",
        body: body || "This is a push notification sent from the backend server!",
        sound: "default",
      }),
    });

    const result = await response.json();
    res.json({ success: true, result });
  } catch (err) {
    console.error("❌ Send push notification error:", err);
    res.status(500).json({ message: "Server error sending push notification" });
  }
});

module.exports = router;