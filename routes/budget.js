const express = require("express");
const router = express.Router();
const Budget = require("../models/Budget");
const { protect } = require("../middleware/authMiddleware");

// CREATE or UPDATE budget
router.post("/", protect, async (req, res) => {
  try {
    const { amount, saveForAllMonths } = req.body;

    const userId = req.user.id;
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    let budget = await Budget.findOne({ userId, month, year });

    if (budget) {
      budget.amount = amount;
      budget.saveForAllMonths = saveForAllMonths || false;
      await budget.save();
    } else {
      budget = await Budget.create({
        userId,
        amount,
        month,
        year,
        saveForAllMonths: saveForAllMonths || false,
      });
    }

    res.json({ success: true, data: budget });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET budget
router.get("/", protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    let budget = await Budget.findOne({ userId, month, year });

    if (!budget) {
      // Look for a carry-over budget
      const carryOverBudget = await Budget.findOne({ userId, saveForAllMonths: true }).sort({ createdAt: -1 });
      if (carryOverBudget) {
        budget = carryOverBudget;
      }
    }

    res.json({ success: true, data: budget });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE budget
router.delete("/", protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    await Budget.findOneAndDelete({ userId, month, year });

    res.json({ success: true, message: "Budget deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;