const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const FoodLog = require('../models/FoodLog');
const mongoose = require('mongoose');

// Create a food log (protected)
router.post('/', auth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.user.id)) {
      return res.status(401).json({ message: 'Invalid user token' });
    }

    const newLog = new FoodLog({
      user: req.user.id,
      items: req.body.items || [],
      amount: Number(req.body.amount) || 0,
      notes: req.body.notes || '',
      restaurant: req.body.restaurant || '',

      mealType: req.body.mealType || "Lunch",
      date: req.body.date,
      time: req.body.time || "",
      rating: Number(req.body.rating) || 0
    });

    await newLog.save();

    // START: Budget Check Logic
    try {
      const User = require('../models/User');
      const Budget = require('../models/Budget');
      const { sendEmail } = require('../utils/email');
      
      const user = await User.findById(req.user.id);
      if (user && user.email) {
        const logDate = new Date(req.body.date);
        const month = logDate.getMonth() + 1;
        const year = logDate.getFullYear();
        const monthString = `${year}-${String(month).padStart(2, '0')}`;

        if (user.lastBudgetAlertMonth !== monthString) {
          const budget = await Budget.findOne({ userId: req.user.id, month, year });
          if (budget) {
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0, 23, 59, 59, 999);
            const allLogsThisMonth = await FoodLog.find({
              user: req.user.id,
              date: { $gte: startDate, $lte: endDate }
            });
            const totalSpent = allLogsThisMonth.reduce((acc, log) => acc + (Number(log.amount) || 0), 0);
            
            if (totalSpent >= budget.amount * 0.7) {
              const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2>Budget Alert for ${month}/${year}! 🚨</h2>
                  <p>Hi ${user.name || 'there'},</p>
                  <p>You have spent <strong>$${totalSpent.toFixed(2)}</strong> this month, which is over 70% of your monthly budget of <strong>$${budget.amount}</strong>.</p>
                  <p>Keep an eye on your expenses!</p>
                </div>
              `;
              await sendEmail(user.email, 'BiteTrack: You are approaching your monthly budget limit', html);
              
              user.lastBudgetAlertMonth = monthString;
              await user.save();
            }
          }
        }
      }
    } catch (budgetError) {
      console.error('Error checking budget threshold:', budgetError);
    }
    // END: Budget Check Logic

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

    log.items = req.body.items || [];
    log.amount = Number(req.body.amount) || 0;
    log.notes = req.body.notes || '';
    log.restaurant = req.body.restaurant || '';

    log.mealType = req.body.mealType || "Lunch";
    log.date = req.body.date;
    log.time = req.body.time || "";
    log.rating = Number(req.body.rating) || 0;

    await log.save();

    res.json(log);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
