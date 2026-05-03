const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const FoodLog = require('../models/FoodLog');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');




// Create a food log (protected)
router.post('/', auth, async (req, res) => {
  try {
    const newLog = new FoodLog({
      user: req.user.id,
      items: req.body.items || [],
      notes: req.body.notes || '',
      restaurant: req.body.restaurant || '',

      mealType: req.body.mealType || "Lunch",
      date: req.body.date,
      time: req.body.time || "",   // ✅ already correct
      rating: Number(req.body.rating) || 0
    });

    await newLog.save();

    const monthlyBudget = Number(req.body.monthlyBudget) || 0;

    if (monthlyBudget > 0) {
      const logDate = new Date(newLog.date);
      const monthStart = new Date(logDate.getFullYear(), logDate.getMonth(), 1);
      const monthEnd = new Date(logDate.getFullYear(), logDate.getMonth() + 1, 1);

      const monthLogs = await FoodLog.find({
        user: req.user.id,
        date: { $gte: monthStart, $lt: monthEnd }
      });

      const monthlySpent = monthLogs.reduce((sum, log) => {
        const entrySpent = (log.items || []).reduce(
          (itemSum, item) => itemSum + (Number(item.calories) || 0),
          0
        );
        return sum + entrySpent;
      }, 0);

      const percentUsed = Math.round((monthlySpent / monthlyBudget) * 100);
      const alertKey = `${logDate.getFullYear()}-${String(logDate.getMonth() + 1).padStart(2, '0')}_${monthlyBudget}_70`;

      if (percentUsed >= 70) {
        const user = await User.findById(req.user.id);

        if (user && user.budgetAlertSentKey !== alertKey && user.email) {
          const remaining = Math.max(monthlyBudget - monthlySpent, 0);

          const sent = await sendEmail(
            user.email,
            'BiteTrack budget alert',
            `
              <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
                <h2 style="margin: 0 0 12px;">You have used 70% or more of your monthly budget</h2>
                <p style="margin: 0 0 8px;">Current month budget: <b>₹${monthlyBudget}</b></p>
                <p style="margin: 0 0 8px;">Spent so far: <b>₹${monthlySpent}</b></p>
                <p style="margin: 0 0 8px;">Remaining: <b>₹${remaining}</b></p>
                <p style="margin: 0 0 8px;">Budget used: <b>${percentUsed}%</b></p>
                <p style="margin: 16px 0 0;">Open BiteTrack and review your Ledger before you overspend.</p>
              </div>
            `
          );

          if (sent) {
            user.budgetAlertSentKey = alertKey;
            await user.save();
          }
        }
      }
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
    const logs = await FoodLog.find({ user: req.user.id })
      .sort({ createdAt: -1 });

    // ✅ FIX: ensure rating is always number
    const formattedLogs = logs.map(log => ({
      ...log.toObject(),
      rating: Number(log.rating) || 0
    }));

    res.json(formattedLogs);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const log = await FoodLog.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id
    });

    if (!log) {
      return res.status(404).json({ message: "Log not found" });
    }

    res.json({ message: "Deleted successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const log = await FoodLog.findById(req.params.id);

    if (!log) {
      return res.status(404).json({ message: "Log not found" });
    }

    if (log.user.toString() !== req.user.id) {
      return res.status(401).json({ message: "Not authorized" });
    }

    // ✅ update BEFORE save
    log.items = req.body.items || [];
    log.notes = req.body.notes || '';
    log.restaurant = req.body.restaurant || '';

    log.mealType = req.body.mealType || "Lunch";
    log.date = req.body.date;
    log.time = req.body.time || "";   // ✅ correct
    log.rating = Number(req.body.rating) || 0;

    await log.save();

    res.json(log);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;