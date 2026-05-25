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
          return `- [ID: ${l._id}] Date: ${dateStr}, Meal: ${l.mealType || 'Unknown'}, Amount Spent: ₹${l.amount || 0}, Items: ${itemsStr}`;
        }).join('\n');
      }
    } catch (formattingError) {
      console.error("Error formatting logs:", formattingError);
      formattedLogs = "Error reading recent food logs. Please continue assisting the user without them.";
    }

    const systemPrompt = `You are an intelligent health and finance assistant named BiteTrack AI. 
The user is asking you a question about their diet, expenses, or health, OR asking you to perform an action.
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

Please provide a helpful, friendly, and concise answer. Do not invent any data.`;

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
                date: { type: "STRING", description: "Date of the meal in YYYY-MM-DD format. Defaults to today if not provided." },
                time: { type: "STRING", description: "Time of the meal in HH:mm format" },
                rating: { type: "NUMBER", description: "Rating out of 5 stars (e.g. 4 for 4 stars)" },
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
                notes: { type: "STRING", description: "Any additional context or notes. Do NOT include ratings here, use the rating field instead." }
              },
              required: ["mealType", "restaurant", "amount", "items"]
            }
          },
          {
            name: "deleteFoodLog",
            description: "Delete a specific food log from the database. Call this when the user asks you to remove, delete, or undo a food log. You MUST use the ID provided in the system prompt logs.",
            parameters: {
              type: "OBJECT",
              properties: {
                logId: { type: "STRING", description: "The exact [ID: ...] string of the log to delete" }
              },
              required: ["logId"]
            }
          },
          {
            name: "editFoodLog",
            description: "Edit/update an existing food log. Call this when the user asks you to modify or change a food log. You MUST use the ID provided in the system prompt logs.",
            parameters: {
              type: "OBJECT",
              properties: {
                logId: { type: "STRING", description: "The exact [ID: ...] string of the log to edit" },
                mealType: { type: "STRING", description: "Must be one of: Breakfast, Lunch, Dinner, Snack" },
                restaurant: { type: "STRING", description: "Name of the restaurant, brand, or 'Home'" },
                amount: { type: "NUMBER", description: "Total cost or amount spent." },
                date: { type: "STRING", description: "Date of the meal in YYYY-MM-DD format." },
                time: { type: "STRING", description: "Time of the meal in HH:mm format" },
                rating: { type: "NUMBER", description: "Rating out of 5 stars (e.g. 4 for 4 stars)" },
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
                notes: { type: "STRING", description: "Any additional context or notes. Do NOT include ratings here, use the rating field instead." }
              },
              required: ["logId"]
            }
          },
          {
            name: "updateProfile",
            description: "Update the user's personal profile (weight, height, age, gender, goal). Call this when they say things like 'my new weight is', 'set my goal to', 'I am 25 years old'.",
            parameters: {
              type: "OBJECT",
              properties: {
                weight: { type: "NUMBER", description: "User's weight in kg" },
                height: { type: "NUMBER", description: "User's height in cm" },
                age: { type: "NUMBER", description: "User's age in years" },
                gender: { type: "STRING", description: "User's gender (male, female, other)" },
                goal: { type: "STRING", description: "User's goal (lose, maintain, gain)" }
              }
            }
          }
        ]
      }
    ];

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest", tools: tools });

    const result = await model.generateContent(systemPrompt);
    
    // Check if the AI decided to call a function
    const calls = result.response.functionCalls();
    if (calls && calls.length > 0) {
      const call = calls[0];
      
      if (call.name === "addFoodLog") {
        const { mealType, restaurant, amount, items, notes, time, rating, date } = call.args;
        let cleanNotes = notes ? notes.replace(/rated\s*\d+\s*stars?/gi, '').trim() : "";
        const newLog = new FoodLog({
          user: req.user.id,
          date: date ? new Date(date) : new Date(),
          mealType: mealType || 'Snack',
          restaurant: restaurant || 'Unknown',
          amount: amount || 0,
          items: items || [],
          notes: cleanNotes,
          time: time || "",
          rating: rating || 0
        });
        await newLog.save();
        const foodNames = items ? items.map(i => i.name).join(', ') : 'your meal';
        return res.json({ reply: `✅ Successfully logged **${foodNames}** for ${mealType} at ${restaurant} (₹${amount}). I have saved this directly to your database!` });
      }

      if (call.name === "deleteFoodLog") {
        const { logId } = call.args;
        const deleted = await FoodLog.findOneAndDelete({ _id: logId, user: req.user.id });
        if (deleted) {
          return res.json({ reply: `🗑️ Successfully deleted the log from ${deleted.date ? new Date(deleted.date).toLocaleDateString() : 'that day'}.` });
        } else {
          return res.json({ reply: `❌ I couldn't find a log with that exact ID to delete, or it might have already been removed.` });
        }
      }

      if (call.name === "editFoodLog") {
        const { logId, mealType, restaurant, amount, items, notes, time, rating, date } = call.args;
        const updates = {};
        if (mealType !== undefined) updates.mealType = mealType;
        if (restaurant !== undefined) updates.restaurant = restaurant;
        if (amount !== undefined) updates.amount = amount;
        if (items !== undefined) updates.items = items;
        if (notes !== undefined) {
          updates.notes = notes ? notes.replace(/rated\s*\d+\s*stars?/gi, '').trim() : "";
        }
        if (time !== undefined) updates.time = time;
        if (rating !== undefined) updates.rating = rating;
        if (date !== undefined) updates.date = new Date(date);

        const updated = await FoodLog.findOneAndUpdate(
          { _id: logId, user: req.user.id },
          { $set: updates },
          { new: true }
        );

        if (updated) {
          return res.json({ reply: `✅ Successfully updated the order.` });
        } else {
          return res.json({ reply: `❌ I couldn't find a log with that exact ID to update, or it might have been removed.` });
        }
      }

      if (call.name === "updateProfile") {
        const updates = call.args;
        if (Object.keys(updates).length > 0) {
          user.profile = { ...user.profile, ...updates };
          await user.save();
          return res.json({ reply: `✅ I have successfully updated your profile with the new information!` });
        }
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
