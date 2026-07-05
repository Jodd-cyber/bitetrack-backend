const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const FoodLog = require('../models/FoodLog');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Validate if items are food using Gemini
async function validateFoodItems(items) {
  if (!items || items.length === 0) return true;
  const names = items.map(i => i.name).filter(Boolean);
  if (names.length === 0) return true;

  try {
    const prompt = `Analyze this list of item names: ${JSON.stringify(names)}. Are all of these generally considered edible foods, beverages, restaurant dishes, grocery ingredients, snacks, or dining-related expenses? Answer with exactly "YES" or "NO" and nothing else.`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim().toUpperCase();
    return text.includes("YES");
  } catch (e) {
    console.error("Gemini food validation error, defaulting to allowed:", e);
    return true; // fail-open so app doesn't break if API/network has issues
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
      const isValidFood = await validateFoodItems(items);
      if (!isValidFood) {
        return res.status(400).json({
          success: false,
          errorType: "NOT_FOOD",
          message: `Nice try! 😅 "${items.map(i => i.name).join(', ')}" doesn't look like food. Let's stick to actual meals, boss!`
        });
      }
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
      rating: Number(req.body.rating) || 0,
      images: req.body.images || [],
      splitInfo: req.body.splitInfo || undefined
    });

    await newLog.save();

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

    const restaurant = req.body.restaurant || log.restaurant;
    const notes = req.body.notes !== undefined ? req.body.notes : log.notes;
    const items = req.body.items || log.items;

    // Skip validation for Tapri logs
    if (restaurant !== "Tapri" && notes !== "Tapri Tracker Log") {
      const isValidFood = await validateFoodItems(items);
      if (!isValidFood) {
        return res.status(400).json({
          success: false,
          errorType: "NOT_FOOD",
          message: `Nice try! 😅 "${items.map(i => i.name).join(', ')}" doesn't look like food. Let's stick to actual meals, boss!`
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

    await log.save();

    res.json(log);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
