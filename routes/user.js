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
    const { age, height, weight, gender, goal } = req.body;
    const user = await User.findById(req.user.id);
    
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.profile = {
      ...user.profile,
      ...(age && { age }),
      ...(height && { height }),
      ...(weight && { weight }),
      ...(gender && { gender }),
      ...(goal && { goal })
    };

    await user.save();
    res.json(user.profile);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating profile" });
  }
});

module.exports = router;