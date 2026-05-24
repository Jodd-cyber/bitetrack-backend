const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const FoodLog = require('../models/FoodLog');
const { GoogleGenerativeAI } = require('@google/generative-ai');

router.post('/chat', auth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ message: "Message is required" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: "AI API key not configured" });
    }

    // 1. Fetch user profile
    const user = await User.findById(req.user.id).select('-password');
    const profile = user.profile || {};

    // Calculate BMR and daily calorie needs if data is available
    let bmr = null;
    let tdee = null; // Total Daily Energy Expenditure (approx)
    if (profile.weight && profile.height && profile.age && profile.gender) {
      if (profile.gender === 'male') {
        bmr = 10 * profile.weight + 6.25 * profile.height - 5 * profile.age + 5;
      } else if (profile.gender === 'female') {
        bmr = 10 * profile.weight + 6.25 * profile.height - 5 * profile.age - 161;
      } else {
        // generic average
        bmr = 10 * profile.weight + 6.25 * profile.height - 5 * profile.age - 78;
      }
      tdee = bmr * 1.2; // Sedentary multiplier
    }

    // 2. Fetch last 7 days of food logs
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const logs = await FoodLog.find({
      user: req.user.id,
      date: { $gte: sevenDaysAgo }
    }).sort({ date: 1 });

    const totalSpent = logs.reduce((sum, log) => sum + (log.amount || 0), 0);

    // 3. Construct System Prompt
    const systemPrompt = `You are an intelligent health and finance assistant named BiteTrack AI. 
The user is asking you a question about their diet, expenses, or health.
Here is the user's profile:
Age: ${profile.age || 'Unknown'}
Height: ${profile.height ? profile.height + ' cm' : 'Unknown'}
Weight: ${profile.weight ? profile.weight + ' kg' : 'Unknown'}
Gender: ${profile.gender || 'Unknown'}
Goal: ${profile.goal || 'Unknown'}
${bmr ? `Calculated Basal Metabolic Rate (BMR): ~${Math.round(bmr)} kcal/day. Maintenance Calories: ~${Math.round(tdee)} kcal/day.` : 'Not enough profile data to calculate exact calorie needs.'}

Here are the user's food logs for the past 7 days:
${logs.length > 0 ? logs.map(l => `- Date: ${l.date ? new Date(l.date).toISOString().split('T')[0] : 'Unknown'}, Meal: ${l.mealType}, Amount Spent: ₹${l.amount}, Items: ${l.items ? l.items.map(i => i.name).join(', ') : 'None'}`).join('\n') : 'No food logs recorded in the last 7 days.'}
Total spent in the last 7 days: ₹${totalSpent}.

User's query: "${message}"

Please provide a helpful, friendly, and concise answer. If they ask about calories, use their BMR to advise them. If they ask for a weekly summary, summarize their spending and eating habits from the logs provided. Do not invent any data.`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(systemPrompt);
    const responseText = result.response.text();

    res.json({ reply: responseText });

  } catch (err) {
    console.error("AI Chat Error:", err);
    res.status(500).json({ message: "Failed to generate AI response" });
  }
});

module.exports = router;
