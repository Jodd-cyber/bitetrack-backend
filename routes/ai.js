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

    // 2. Fetch last 30 days of food logs
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const logs = await FoodLog.find({
      user: req.user.id,
      date: { $gte: thirtyDaysAgo }
    }).sort({ date: 1 });

    const totalSpent = logs.reduce((sum, log) => sum + (log.amount || 0), 0);

    let formattedLogs = 'No food logs recorded in the last 30 days.';
    try {
      if (logs && logs.length > 0) {
        formattedLogs = logs.map(l => {
          const dateStr = l.date ? new Date(l.date).toISOString().split('T')[0] : 'Unknown';
          const itemsStr = (l.items && Array.isArray(l.items)) ? l.items.map(i => i?.name || 'Unknown').join(', ') : 'None';
          return `- Date: ${dateStr}, Meal: ${l.mealType || 'Unknown'}, Amount Spent: ₹${l.amount || 0}, Items: ${itemsStr}`;
        }).join('\n');
      }
    } catch (formattingError) {
      console.error("Error formatting logs:", formattingError);
      formattedLogs = "Error reading recent food logs. Please continue assisting the user without them.";
    }

    const systemPrompt = `You are an intelligent health and finance assistant named BiteTrack AI. 
The user is asking you a question about their diet, expenses, or health.
Here is the user's profile:
Age: ${profile.age || 'Unknown'}
Height: ${profile.height ? profile.height + ' cm' : 'Unknown'}
Weight: ${profile.weight ? profile.weight + ' kg' : 'Unknown'}
Gender: ${profile.gender || 'Unknown'}
Goal: ${profile.goal || 'Unknown'}
${bmr ? `Calculated Basal Metabolic Rate (BMR): ~${Math.round(bmr)} kcal/day. Maintenance Calories: ~${Math.round(tdee)} kcal/day.` : 'Not enough profile data to calculate exact calorie needs.'}

Here are the user's food logs for the past 30 days:
${formattedLogs}
Total spent in the last 30 days: ₹${totalSpent}.

User's query: "${message}"

Please provide a helpful, friendly, and concise answer. If they ask about calories, use their BMR to advise them. If they ask for a weekly summary, summarize their spending and eating habits from the logs provided. Do not invent any data.`;

    // Define the tools for the AI to use
    const tools = [
      {
        functionDeclarations: [
          {
            name: "addFoodLog",
            description: "Log a new food entry/order for the user in the database. Call this when the user explicitly asks you to log, save, or record something they ate.",
            parameters: {
              type: "OBJECT",
              properties: {
                mealType: { type: "STRING", description: "Must be one of: Breakfast, Lunch, Dinner, Snack" },
                restaurant: { type: "STRING", description: "Name of the restaurant, brand, or 'Home'" },
                amount: { type: "NUMBER", description: "Total cost or amount spent. Use 0 if unknown or home cooked." },
                items: { 
                  type: "ARRAY", 
                  description: "List of food items eaten",
                  items: {
                    type: "OBJECT",
                    properties: {
                      name: { type: "STRING", description: "Name of the food item (e.g. Pizza, Salad)" },
                      quantity: { type: "NUMBER", description: "Quantity of this item" }
                    }
                  }
                },
                notes: { type: "STRING", description: "Any additional context or notes" }
              },
              required: ["mealType", "restaurant", "amount", "items"]
            }
          }
        ]
      }
    ];

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", tools: tools });

    const result = await model.generateContent(systemPrompt);
    
    // Check if the AI decided to call a function
    const calls = result.response.functionCalls();
    if (calls && calls.length > 0) {
      const call = calls[0];
      if (call.name === "addFoodLog") {
        const { mealType, restaurant, amount, items, notes } = call.args;
        
        const newLog = new FoodLog({
          user: req.user.id,
          date: new Date(),
          mealType: mealType || 'Snack',
          restaurant: restaurant || 'Unknown',
          amount: amount || 0,
          items: items || [],
          notes: notes || ""
        });
        
        await newLog.save();
        
        // Return a custom success message without needing a second API call
        const foodNames = items ? items.map(i => i.name).join(', ') : 'your meal';
        return res.json({ reply: `✅ Successfully logged **${foodNames}** for ${mealType} at ${restaurant} (₹${amount}). I have saved this directly to your database!` });
      }
    }

    const responseText = result.response.text();
    res.json({ reply: responseText });

  } catch (err) {
    console.error("AI Chat Error:", err);
    res.status(500).json({ message: `AI Error: ${err.message}` });
  }
});

module.exports = router;
