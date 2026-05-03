const express = require("express");
const auth = require("../middleware/auth");
const sendEmail = require("../utils/sendEmail");

const router = express.Router();

router.post("/budget-alert", auth, async (req, res) => {
  try {
    const { budget, spent, percent } = req.body;
    const budgetValue = Number(budget) || 0;
    const spentValue = Number(spent) || 0;
    const percentValue = Number(percent) || 0;

    if (!req.user?.email) {
      return res.status(400).json({ success: false, message: "User email not found" });
    }

    const remaining = Math.max(budgetValue - spentValue, 0);
    const subject = "BiteTrack budget alert";
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2 style="margin: 0 0 12px;">You have used 70% or more of your monthly budget</h2>
        <p style="margin: 0 0 8px;">Current month budget: <b>₹${budgetValue}</b></p>
        <p style="margin: 0 0 8px;">Spent so far: <b>₹${spentValue}</b></p>
        <p style="margin: 0 0 8px;">Remaining: <b>₹${remaining}</b></p>
        <p style="margin: 0 0 8px;">Budget used: <b>${percentValue}%</b></p>
        <p style="margin: 16px 0 0;">Open BiteTrack and review your Ledger before you overspend.</p>
      </div>
    `;

    const sent = await sendEmail(req.user.email, subject, html);

    if (!sent) {
      return res.status(500).json({ success: false, message: "Failed to send budget alert" });
    }

    return res.json({ success: true, message: "Budget alert email sent" });
  } catch (error) {
    console.error("Budget alert error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;