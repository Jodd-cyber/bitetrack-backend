const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

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

module.exports = router;