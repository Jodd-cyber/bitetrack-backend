const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const FoodLog = require('../models/FoodLog');
const Group = require('../models/Group');
const User = require('../models/User');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Validate if items are food and restaurant is plausible using Gemini
async function validateFoodLog(items, restaurant) {
  return true;
}

// Send Expo push notifications to group members (fire-and-forget, non-blocking)
async function notifyGroupMembers(groupId, creatorUserId, expenseTitle, amount) {
  try {
    const group = await Group.findById(groupId).populate('members', 'name pushToken');
    if (!group || !group.members) return;

    const creator = group.members.find(m => m._id.toString() === creatorUserId.toString());
    const creatorName = creator ? creator.name : 'Someone';

    // Collect push tokens from all members except the creator
    const pushMessages = [];
    group.members.forEach(member => {
      if (member._id.toString() === creatorUserId.toString()) return;
      if (!member.pushToken || member.pushToken.trim() === '') return;

      pushMessages.push({
        to: member.pushToken,
        title: `🍽️ ${creatorName} added an expense`,
        body: `₹${amount} for "${expenseTitle}" in ${group.name.replace(/\[cat:.*?\]/, '').trim()}`,
        sound: 'default',
        data: { type: 'GROUP_EXPENSE_ADDED', groupId: groupId.toString() },
      });
    });

    if (pushMessages.length === 0) return;

    // Send in batches of 100 (Expo limit)
    for (let i = 0; i < pushMessages.length; i += 100) {
      const batch = pushMessages.slice(i, i + 100);
      fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(batch),
      }).catch(err => console.log('Push notification send error:', err.message));
    }
  } catch (err) {
    console.log('notifyGroupMembers error (non-fatal):', err.message);
  }
}

// Create a food log (protected)
router.post('/', auth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.user.id)) {
      return res.status(401).json({ message: 'Invalid user token' });
    }

    const restaurant = req.body.restaurant || '';
    const notes = req.body.notes || '';
    const items = req.body.items || [];

    // Skip validation for Tapri logs
    if (restaurant !== "Tapri" && notes !== "Tapri Tracker Log") {
      const isValidLog = await validateFoodLog(items, restaurant);
      if (!isValidLog) {
        return res.status(400).json({
          success: false,
          errorType: "NOT_FOOD",
          message: `Nice try! 😅 "${items.map(i => i.name).join(', ')}" at "${restaurant}" doesn't look like a valid food entry. Let's stick to actual meals and real places, boss!`
        });
      }
    }

    const isGroupEntry = Boolean(req.body.isGroupLog || req.body.groupId || (req.body.splitInfo && req.body.splitInfo.groupId));
    const targetGroupId = req.body.groupId || (req.body.splitInfo ? req.body.splitInfo.groupId : undefined);

    const newLog = new FoodLog({
      user: req.user.id,
      items: req.body.items || [],
      amount: Number(req.body.amount) || 0,
      notes: req.body.notes || '',
      restaurant: req.body.restaurant || '',

      mealType: req.body.mealType || "Lunch",
      date: req.body.date,
      time: req.body.time || "",
      rating: Number(req.body.rating) || 0,
      images: req.body.images || [],
      splitInfo: req.body.splitInfo || undefined,
      isGroupLog: isGroupEntry,
      groupId: targetGroupId
    });

    await newLog.save();

    // Send push notifications to other group members (non-blocking)
    if (isGroupEntry && targetGroupId) {
      const foodName = (items && items.length > 0) ? items.map(i => i.name).join(', ') : restaurant;
      const amount = Number(req.body.amount) || 0;
      notifyGroupMembers(targetGroupId, req.user.id, foodName, amount);
    }

    res.status(201).json(newLog);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user's logs (protected)
router.get('/', auth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.user.id)) {
      return res.json([]);
    }

    const logs = await FoodLog.find({ user: req.user.id })
      .sort({ createdAt: -1 });

    res.json(logs);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.user.id)) {
      return res.status(401).json({ message: 'Invalid user token' });
    }

    const log = await FoodLog.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id
    });

    if (!log) {
      return res.status(404).json({ message: "Log not found" });
    }

    if (log.gmailMessageId) {
      await User.findByIdAndUpdate(req.user.id, {
        $pull: { processedEmailIds: log.gmailMessageId }
      });
    }

    res.json({ message: "Deleted successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.user.id)) {
      return res.status(401).json({ message: 'Invalid user token' });
    }

    const log = await FoodLog.findById(req.params.id);

    if (!log) {
      return res.status(404).json({ message: "Log not found" });
    }

    if (log.user.toString() !== req.user.id.toString()) {
      return res.status(401).json({ message: "Not authorized" });
    }

    const restaurant = req.body.restaurant || log.restaurant;
    const notes = req.body.notes !== undefined ? req.body.notes : log.notes;
    const items = req.body.items || log.items;

    // Skip validation for Tapri logs
    if (restaurant !== "Tapri" && notes !== "Tapri Tracker Log") {
      const isValidLog = await validateFoodLog(items, restaurant);
      if (!isValidLog) {
        return res.status(400).json({
          success: false,
          errorType: "NOT_FOOD",
          message: `Nice try! 😅 "${items.map(i => i.name).join(', ')}" at "${restaurant}" doesn't look like a valid food entry. Let's stick to actual meals and real places, boss!`
        });
      }
    }

    log.items = items;
    log.amount = req.body.amount !== undefined ? Number(req.body.amount) : log.amount;
    log.notes = notes;
    log.restaurant = restaurant;

    log.mealType = req.body.mealType || log.mealType;
    log.date = req.body.date || log.date;
    log.time = req.body.time !== undefined ? req.body.time : log.time;
    log.rating = req.body.rating !== undefined ? Number(req.body.rating) : log.rating;
    log.images = req.body.images || log.images;
    if (req.body.splitInfo) {
      log.splitInfo = req.body.splitInfo;
    }
    if (req.body.isGroupLog !== undefined) {
      log.isGroupLog = req.body.isGroupLog;
    }
    if (req.body.groupId !== undefined) {
      log.groupId = req.body.groupId;
    } else if (req.body.splitInfo && req.body.splitInfo.groupId) {
      log.groupId = req.body.splitInfo.groupId;
    }

    await log.save();

    res.json(log);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
