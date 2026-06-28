const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const FoodLog = require('../models/FoodLog');
const ChatSession = require('../models/ChatSession');
const Budget = require('../models/Budget');
const Group = require('../models/Group');
const Settlement = require('../models/Settlement');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

router.post('/chat', auth, async (req, res) => {
  try {
    const { message, sessionId, fileBase64, mimeType } = req.body;
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

    // Fetch user's groups context
    const userGroups = await Group.find({ members: req.user.id });
    let groupsContext = "No active BiteSplit groups.";
    if (userGroups && userGroups.length > 0) {
      const populatedGroups = [];
      for (const group of userGroups) {
        const members = await User.find({ _id: { $in: group.members } }).select('name email');
        const memberList = members.map(m => `${m.name} (User ID: ${m._id}, Email: ${m.email})`).join(', ');
        
        const pendingSettlements = await Settlement.find({ groupId: group._id, status: 'pending' }).populate('fromUser toUser', 'name');
        const settlementsStr = pendingSettlements.length > 0
          ? pendingSettlements.map(s => `[Settlement ID: ${s._id}] ${s.fromUser?.name || 'Unknown'} paid ${s.toUser?.name || 'Unknown'} ₹${s.amount}`).join('; ')
          : "None";
          
        populatedGroups.push(`- Group Name: "${group.name}" (Group ID: ${group._id}, Invite Code: ${group.inviteCode})\n  Members: ${memberList}\n  Pending Settlements: ${settlementsStr}`);
      }
      groupsContext = populatedGroups.join('\n');
    }

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

    let previousContext = "";
    let chatSession = null;
    if (sessionId) {
      chatSession = await ChatSession.findOne({ _id: sessionId, user: req.user.id });
      if (chatSession) {
        previousContext = chatSession.messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
      }
    }
    if (!chatSession) {
      chatSession = new ChatSession({ user: req.user.id, messages: [] });
    }

    const aiConfig = profile.aiAssistant || { name: "AI Assistant", personality: "normal" };
    const customName = aiConfig.name || "AI Assistant";
    const customPersonality = aiConfig.personality || "normal";

    let personalityPrompt = "";
    if (customPersonality === "drill") {
      personalityPrompt = `Your name is "${customName}". Speak in the personality of a strict, highly direct, and intense "Drill Sergeant". Be blunt, call out overspending and overeating directly, and motivate the user with tough love.`;
    } else if (customPersonality === "coach") {
      personalityPrompt = `Your name is "${customName}". Speak in the personality of a warm, encouraging, and highly motivational "Coach". Focus on positivity, support, and building self-confidence.`;
    } else if (customPersonality === "chef") {
      personalityPrompt = `Your name is "${customName}". Speak in the personality of a passionate, foodie "Culinary Master Chef". Suggest healthy recipe alternatives, calorie-saving ingredient swaps, and cooking guidance.`;
    } else {
      personalityPrompt = `Your name is "${customName}". Maintain a normal, friendly, professional, and helpful assistant tone.`;
    }

    const systemPrompt = `You are an intelligent health and finance assistant named ${customName}. 
${personalityPrompt}
The user is asking you a question about their diet, expenses, or health, OR asking you to perform an action.
Here is the user's profile:
Age: ${profile.age || 'Unknown'}
Height: ${profile.height ? profile.height + ' cm' : 'Unknown'}
Weight: ${profile.weight ? profile.weight + ' kg' : 'Unknown'}
Gender: ${profile.gender || 'Unknown'}
Goal: ${profile.goal || 'Unknown'}
${bmr ? `Calculated Basal Metabolic Rate (BMR): ~${Math.round(bmr)} kcal/day. Maintenance Calories: ~${Math.round(tdee)} kcal/day.` : 'Not enough profile data to calculate exact calorie needs.'}

Here is the user's BiteSplit Group Context (their shared expenses groups, members, and pending transactions):
${groupsContext}

Here are the user's food logs for the past 30 days:
${formattedLogs}
Total spent in the last 30 days: ₹${totalSpent}.

Previous Conversation History:
${previousContext || "No previous conversation."}

User's new query: "${message}"

INSTRUCTIONS FOR DIET PLANS & HEALTH:
- If the user asks you to create, generate, make, or update a diet plan, or if they upload a photo, document, PDF, or paste text containing a diet chart/plan (either for a single day or a 7-day week), you MUST read it, parse it, extract the meals and estimated calories day-by-day, and save it.
- If it is a 7-day weekly schedule, extract meals for each day (Monday to Sunday) and call 'saveDietPlan' with isWeekly=true and the weekly data.
- If it is a single-day plan, call 'saveDietPlan' with isWeekly=false and the daily data.
- You are fully authorized to generate food recipes and meal recommendations; do not ask the user what to put, generate it for them!
- For health queries, give complete, helpful, and science-backed nutritional advice. Do not say you cannot answer.

Please provide a helpful, friendly, and concise answer. (Do not invent historical food logs, but do design and suggest diet plans/meals when asked).`;

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
          },
          {
            name: "syncGmailOrders",
            description: "Check the user's connected Gmail account to find and save Swiggy/Zomato orders. Call this when the user asks you to check their email, sync their Gmail, or look for a specific order from Swiggy/Zomato in their email.",
            parameters: {
              type: "OBJECT",
              properties: {
                specificDateQuery: { type: "STRING", description: "Optional. A specific date string (e.g. '2026/04/30') to search for. Format must be YYYY/MM/DD. If omitted, will search recent emails." }
              }
            }
          },
          {
            name: "saveDietPlan",
            description: "Save a structured daily or weekly diet plan. Call this when the user asks you to create, save, or update their diet plan, meal plan, or diet chart (either a single-day plan or a 7-day weekly plan).",
            parameters: {
              type: "OBJECT",
              properties: {
                isWeekly: { type: "BOOLEAN", description: "Set to true if this is a 7-day weekly plan, false if it's a single daily plan." },
                daily: {
                  type: "OBJECT",
                  description: "Single daily diet plan (use if isWeekly is false)",
                  properties: {
                    breakfast: {
                      type: "OBJECT",
                      properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } }
                    },
                    lunch: {
                      type: "OBJECT",
                      properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } }
                    },
                    dinner: {
                      type: "OBJECT",
                      properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } }
                    },
                    snack: {
                      type: "OBJECT",
                      properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } }
                    }
                  }
                },
                weekly: {
                  type: "OBJECT",
                  description: "7-day weekly diet plan (use if isWeekly is true)",
                  properties: {
                    monday: {
                      type: "OBJECT",
                      properties: {
                        breakfast: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        lunch: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        dinner: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        snack: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } }
                      }
                    },
                    tuesday: {
                      type: "OBJECT",
                      properties: {
                        breakfast: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        lunch: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        dinner: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        snack: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } }
                      }
                    },
                    wednesday: {
                      type: "OBJECT",
                      properties: {
                        breakfast: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        lunch: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        dinner: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        snack: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } }
                      }
                    },
                    thursday: {
                      type: "OBJECT",
                      properties: {
                        breakfast: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        lunch: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        dinner: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        snack: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } }
                      }
                    },
                    friday: {
                      type: "OBJECT",
                      properties: {
                        breakfast: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        lunch: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        dinner: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        snack: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } }
                      }
                    },
                    saturday: {
                      type: "OBJECT",
                      properties: {
                        breakfast: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        lunch: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        dinner: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        snack: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } }
                      }
                    },
                    sunday: {
                      type: "OBJECT",
                      properties: {
                        breakfast: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        lunch: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        dinner: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } },
                        snack: { type: "OBJECT", properties: { name: { type: "STRING" }, calories: { type: "NUMBER" } } }
                      }
                    }
                  }
                }
              },
              required: ["isWeekly"]
            },
            {
              name: "createGroup",
              description: "Create a new shared expense group (BiteSplit).",
              parameters: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING", description: "Name of the group (e.g. Roommates)" }
                },
                required: ["name"]
              }
            },
            {
              name: "joinGroup",
              description: "Join an existing shared expense group (BiteSplit) using an invite code.",
              parameters: {
                type: "OBJECT",
                properties: {
                  inviteCode: { type: "STRING", description: "The 6-character alphanumeric invite code (e.g., AB12CD)" }
                },
                required: ["inviteCode"]
              }
            },
            {
              name: "addSplitFoodLog",
              description: "Log a split bill/transaction for a BiteSplit group. Paid by the current user.",
              parameters: {
                type: "OBJECT",
                properties: {
                  mealType: { type: "STRING", description: "Breakfast, Lunch, Dinner, Snack" },
                  restaurant: { type: "STRING", description: "Restaurant or food provider" },
                  amount: { type: "NUMBER", description: "Total bill amount to split" },
                  groupId: { type: "STRING", description: "Group ID to post the split to" },
                  splitMethod: { type: "STRING", description: "equal or unequal" },
                  shares: {
                    type: "ARRAY",
                    description: "Explicit user shares for unequal splits. For equal splits, omit this.",
                    items: {
                      type: "OBJECT",
                      properties: {
                        userId: { type: "STRING", description: "The member's User ID" },
                        amount: { type: "NUMBER", description: "Their share of the bill" }
                      }
                    }
                  },
                  items: {
                    type: "ARRAY",
                    description: "Optional list of items",
                    items: {
                      type: "OBJECT",
                      properties: {
                        name: { type: "STRING" },
                        quantity: { type: "NUMBER" }
                      }
                    }
                  },
                  notes: { type: "STRING" }
                },
                required: ["mealType", "restaurant", "amount", "groupId", "splitMethod"]
              }
            },
            {
              name: "createGroupSettlement",
              description: "Record a settlement payment to another member in the group (removes your debt).",
              parameters: {
                type: "OBJECT",
                properties: {
                  groupId: { type: "STRING", description: "Group ID" },
                  toUserId: { type: "STRING", description: "The User ID of the person you paid" },
                  amount: { type: "NUMBER", description: "Amount paid to settle" }
                },
                required: ["groupId", "toUserId", "amount"]
              }
            },
            {
              name: "acceptGroupSettlement",
              description: "Accept and confirm a pending settlement payment sent to you (clears their debt).",
              parameters: {
                type: "OBJECT",
                properties: {
                  groupId: { type: "STRING", description: "Group ID" },
                  settlementId: { type: "STRING", description: "The pending Settlement ID" }
                },
                required: ["groupId", "settlementId"]
              }
            }
          ]
        }
      ];

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", tools: tools });

    let contentInput;
    if (fileBase64 && mimeType) {
      contentInput = [
        systemPrompt,
        {
          inlineData: {
            data: fileBase64,
            mimeType: mimeType
          }
        }
      ];
    } else {
      contentInput = systemPrompt;
    }

    const result = await model.generateContent(contentInput);
    
    // Check if the AI decided to call a function
    const calls = result.response.functionCalls();
    let replyText = "";
    
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
        replyText = `✅ Successfully logged **${foodNames}** for ${mealType} at ${restaurant} (₹${amount}). I have saved this directly to your database!`;
      }
      else if (call.name === "deleteFoodLog") {
        const { logId } = call.args;
        const deleted = await FoodLog.findOneAndDelete({ _id: logId, user: req.user.id });
        if (deleted) {
          replyText = `🗑️ Successfully deleted the log from ${deleted.date ? new Date(deleted.date).toLocaleDateString() : 'that day'}.`;
        } else {
          replyText = `❌ I couldn't find a log with that exact ID to delete, or it might have already been removed.`;
        }
      }
      else if (call.name === "editFoodLog") {
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
          replyText = `✅ Successfully updated the order.`;
        } else {
          replyText = `❌ I couldn't find a log with that exact ID to update, or it might have been removed.`;
        }
      }
      else if (call.name === "updateProfile") {
        const updates = call.args;
        if (Object.keys(updates).length > 0) {
          user.profile = { ...user.profile, ...updates };
          await user.save();
          replyText = `✅ I have successfully updated your profile with the new information!`;
        }
      }
      else if (call.name === "syncGmailOrders") {
        const { specificDateQuery } = call.args;
        if (!user.gmailSyncTokens || !user.gmailSyncTokens.access_token) {
          replyText = `❌ Your Gmail account is not connected. Please go to the Ledger page and click "Sync Zomato/Swiggy from Gmail" to connect it first!`;
        } else {
          try {
            const client = new google.auth.OAuth2(
              process.env.GOOGLE_CLIENT_ID,
              process.env.GOOGLE_CLIENT_SECRET
            );
            client.setCredentials(user.gmailSyncTokens);
            
            client.on('tokens', async (tokens) => {
              if (tokens.refresh_token) {
                user.gmailSyncTokens.refresh_token = tokens.refresh_token;
              }
              user.gmailSyncTokens.access_token = tokens.access_token;
              user.gmailSyncTokens.expiry_date = tokens.expiry_date;
              await user.save();
            });

            const gmail = google.gmail({ version: 'v1', auth: client });
            let baseQuery = '(from:noreply@zomato.com OR from:swiggy@swiggy.in OR from:noreply@swiggy.in) (subject:"Order" OR subject:"Receipt" OR subject:"Summary")';
            if (specificDateQuery) {
              baseQuery += ` after:${specificDateQuery.replace(/\//g, '/')} before:${new Date(new Date(specificDateQuery).getTime() + 86400000 * 2).toISOString().split('T')[0].replace(/-/g, '/')}`; // give a 2 day window
            }

            const response = await gmail.users.messages.list({
              userId: 'me',
              q: baseQuery,
              maxResults: 20
            });

            const messages = response.data.messages || [];
            if (messages.length === 0) {
              replyText = `I checked your Gmail ${specificDateQuery ? 'around ' + specificDateQuery : 'recently'} but couldn't find any Swiggy or Zomato orders.`;
            } else {
              let newOrdersCount = 0;
              for (let msg of messages) {
                const msgData = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
                let emailText = "";
                const extractText = (parts) => {
                  for (let part of parts) {
                    if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
                      if (part.body && part.body.data) {
                        let decoded = Buffer.from(part.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
                        if (part.mimeType === 'text/html') {
                          // Strip simple HTML tags to reduce token size, keep text
                          decoded = decoded.replace(/<style[^>]*>.*?<\/style>/gi, '')
                                           .replace(/<script[^>]*>.*?<\/script>/gi, '')
                                           .replace(/<[^>]+>/g, ' ')
                                           .replace(/\s+/g, ' ');
                        }
                        emailText += decoded + "\n";
                      }
                    }
                    else if (part.parts) extractText(part.parts);
                  }
                };
                if (msgData.data.payload.parts) extractText(msgData.data.payload.parts);
                else if (msgData.data.payload.body.data) {
                   let decoded = Buffer.from(msgData.data.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
                   emailText = decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
                }
                
                if (!emailText.trim()) continue;

                const emailTimestamp = parseInt(msgData.data.internalDate);
                const emailDateObj = new Date(emailTimestamp);
                const emailDateStr = emailDateObj.toISOString().split('T')[0];
                const emailTimeStr = emailDateObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

                const prompt = `You are an expert receipt parser. Extract the food order details from this raw email text. STRICTLY JSON.
{ "restaurant": "name", "date": "YYYY-MM-DD", "time": "HH:mm", "amount": number, "items": [{ "name": "name", "calories": number }] }
IMPORTANT: This email was received on ${emailDateStr} at ${emailTimeStr}. If the exact order time is not explicitly found in the text, use ${emailTimeStr} as the time and ${emailDateStr} as the date.
If NOT valid food order, return { "invalid": true }. Text: ${emailText.substring(0, 4000)}`;

                try {
                  const aiResult = await model.generateContent(prompt);
                  const jsonStr = aiResult.response.text().replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();
                  const parsed = JSON.parse(jsonStr);
                  if (parsed.invalid || !parsed.restaurant || !parsed.amount) continue;

                  const existing = await FoodLog.findOne({ user: req.user.id, amount: parsed.amount, restaurant: new RegExp(parsed.restaurant, 'i') });
                  if (!existing) {
                    const newLog = new FoodLog({
                      user: req.user.id,
                      date: parsed.date ? new Date(parsed.date) : new Date(),
                      time: parsed.time || "12:00",
                      mealType: "Dinner",
                      restaurant: parsed.restaurant,
                      amount: parsed.amount,
                      items: parsed.items || [],
                      notes: "Synced via AI Assistant."
                    });
                    await newLog.save();
                    newOrdersCount++;
                  }
                } catch (e) { console.error("AI Assistant Gmail parse error", e.message); }
              }
              replyText = newOrdersCount > 0 
                ? `✅ I found and synced **${newOrdersCount} new orders** from your Gmail!` 
                : `I checked the matching emails, but those orders were either already synced or didn't contain valid receipt details.`;
            }
          } catch (gmailErr) {
            console.error("Gmail tool error:", gmailErr);
            replyText = `❌ I encountered an error while trying to read your Gmail: ${gmailErr.message}`;
          }
        }
      }
      else if (call.name === "saveDietPlan") {
        const { isWeekly, daily, weekly } = call.args;

        user.profile = {
          ...user.profile,
          dietPlan: {
            isWeekly: !!isWeekly,
            daily: daily || {
              breakfast: { name: "", calories: 0 },
              lunch: { name: "", calories: 0 },
              dinner: { name: "", calories: 0 },
              snack: { name: "", calories: 0 }
            },
            weekly: weekly || {
              monday: { breakfast: { name: "", calories: 0 }, lunch: { name: "", calories: 0 }, dinner: { name: "", calories: 0 }, snack: { name: "", calories: 0 } },
              tuesday: { breakfast: { name: "", calories: 0 }, lunch: { name: "", calories: 0 }, dinner: { name: "", calories: 0 }, snack: { name: "", calories: 0 } },
              wednesday: { breakfast: { name: "", calories: 0 }, lunch: { name: "", calories: 0 }, dinner: { name: "", calories: 0 }, snack: { name: "", calories: 0 } },
              thursday: { breakfast: { name: "", calories: 0 }, lunch: { name: "", calories: 0 }, dinner: { name: "", calories: 0 }, snack: { name: "", calories: 0 } },
              friday: { breakfast: { name: "", calories: 0 }, lunch: { name: "", calories: 0 }, dinner: { name: "", calories: 0 }, snack: { name: "", calories: 0 } },
              saturday: { breakfast: { name: "", calories: 0 }, lunch: { name: "", calories: 0 }, dinner: { name: "", calories: 0 }, snack: { name: "", calories: 0 } },
              sunday: { breakfast: { name: "", calories: 0 }, lunch: { name: "", calories: 0 }, dinner: { name: "", calories: 0 }, snack: { name: "", calories: 0 } }
            }
          }
        };

        await user.save();
        
        if (isWeekly) {
          replyText = `🥗 I have successfully created and saved your customized 7-day weekly diet plan!\n\n` +
            `It has been saved to your profile and is now visible on your Dashboard, where it will display day-by-day!`;
        } else {
          const b = daily?.breakfast?.name || "None";
          const l = daily?.lunch?.name || "None";
          const d = daily?.dinner?.name || "None";
          replyText = `🥗 I have successfully created and saved your daily diet plan!\n\n` +
            `* **Breakfast:** ${b} (~${daily?.breakfast?.calories || 0} kcal)\n` +
            `* **Lunch:** ${l} (~${daily?.lunch?.calories || 0} kcal)\n` +
            `* **Dinner:** ${d} (~${daily?.dinner?.calories || 0} kcal)\n` +
            `\nThis diet chart has been saved and is now visible on your Dashboard!`;
        }
      }
      else if (call.name === "createGroup") {
        const { name } = call.args;
        try {
          let inviteCode = "";
          let codeExists = true;
          while (codeExists) {
            inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const existing = await Group.findOne({ inviteCode });
            if (!existing) codeExists = false;
          }
          const group = await Group.create({
            name: name.trim(),
            inviteCode,
            members: [req.user.id],
            createdBy: req.user.id,
          });
          replyText = `👥 Group **"${group.name}"** has been created successfully!\n\n` +
            `* **Invite Code:** \`${group.inviteCode}\`\n` +
            `* **Group ID:** \`${group._id}\`\n\n` +
            `Share the invite code with other users so they can join!`;
        } catch (groupErr) {
          console.error("Create group tool error:", groupErr);
          replyText = `❌ Failed to create group: ${groupErr.message}`;
        }
      }
      else if (call.name === "joinGroup") {
        const { inviteCode } = call.args;
        try {
          const cleanCode = inviteCode.trim().toUpperCase();
          const group = await Group.findOne({ inviteCode: cleanCode });
          if (!group) {
            replyText = `❌ Could not find a group with invite code \`${cleanCode}\`. Please verify the code and try again!`;
          } else {
            if (group.members.some(m => m.toString() === req.user.id.toString())) {
              replyText = `👥 You are already a member of the group **"${group.name}"**!`;
            } else {
              group.members.push(req.user.id);
              await group.save();
              replyText = `👥 Success! You have joined the group **"${group.name}"**!`;
            }
          }
        } catch (joinErr) {
          console.error("Join group tool error:", joinErr);
          replyText = `❌ Failed to join group: ${joinErr.message}`;
        }
      }
      else if (call.name === "addSplitFoodLog") {
        const { mealType, restaurant, amount, groupId, splitMethod, shares, items, notes } = call.args;
        try {
          const group = await Group.findById(groupId);
          if (!group) {
            replyText = `❌ Group not found. Please verify the group ID or name.`;
          } else {
            const validatedShares = [];
            const sharesList = shares || [];
            
            if (splitMethod === "equal") {
              const equalShare = amount / group.members.length;
              for (const memberId of group.members) {
                validatedShares.push({
                  user: memberId,
                  amount: Math.round(equalShare * 100) / 100
                });
              }
            } else {
              for (const sh of sharesList) {
                validatedShares.push({
                  user: sh.userId,
                  amount: Number(sh.amount)
                });
              }
            }
            
            const newLog = await FoodLog.create({
              user: req.user.id,
              items: items || [{ name: "Food Item", quantity: 1 }],
              amount: Number(amount),
              notes: notes || "Logged via AI assistant",
              restaurant: restaurant,
              mealType: mealType || "Lunch",
              date: new Date(),
              time: new Date().toTimeString().slice(0, 5),
              splitInfo: {
                isSplit: true,
                groupId,
                paidBy: req.user.id,
                splitMethod: splitMethod || "equal",
                shares: validatedShares
              }
            });
            
            replyText = `💸 Split bill logged successfully!\n\n` +
              `* **Restaurant:** ${restaurant}\n` +
              `* **Total:** ₹${amount}\n` +
              `* **Group:** ${group.name}\n` +
              `* **Method:** Split ${splitMethod === 'equal' ? 'Equally' : 'Unequally'}\n\n` +
              `The transaction has been posted to the ledger and split between the group members!`;
          }
        } catch (splitLogErr) {
          console.error("Add split log tool error:", splitLogErr);
          replyText = `❌ Failed to log split transaction: ${splitLogErr.message}`;
        }
      }
      else if (call.name === "createGroupSettlement") {
        const { groupId, toUserId, amount } = call.args;
        try {
          const group = await Group.findById(groupId);
          if (!group) {
            replyText = `❌ Group not found.`;
          } else {
            const isFromMember = group.members.some(m => m.toString() === req.user.id.toString());
            const isToMember = group.members.some(m => m.toString() === toUserId.toString());
            if (!isFromMember || !isToMember) {
              replyText = `❌ Both users must be members of the selected group.`;
            } else {
              const settlement = await Settlement.create({
                groupId,
                fromUser: req.user.id,
                toUser: toUserId,
                amount: Number(amount),
                status: 'pending',
              });
              
              const toUserDoc = await User.findById(toUserId);
              replyText = `🤝 Settlement payment of **₹${amount}** to **${toUserDoc ? toUserDoc.name : 'User'}** has been recorded!\n` +
                `* **Status:** Pending approval\n\n` +
                `The recipient must approve this settlement to clear the debt from the ledger.`;
            }
          }
        } catch (settlErr) {
          console.error("Create settlement tool error:", settlErr);
          replyText = `❌ Failed to record settlement payment: ${settlErr.message}`;
        }
      }
      else if (call.name === "acceptGroupSettlement") {
        const { groupId, settlementId } = call.args;
        try {
          const group = await Group.findById(groupId);
          if (!group) {
            replyText = `❌ Group not found.`;
          } else {
            const settlement = await Settlement.findById(settlementId);
            if (!settlement) {
              replyText = `❌ Settlement transaction not found.`;
            } else if (settlement.toUser.toString() !== req.user.id.toString()) {
              replyText = `❌ Only the recipient (the person who was paid) can approve this settlement.`;
            } else {
              settlement.status = "completed";
              await settlement.save();
              
              const payer = await User.findById(settlement.fromUser);
              replyText = `✅ Settlement approved! The payment of **₹${settlement.amount}** from **${payer ? payer.name : 'User'}** has been confirmed and marked as completed. The debt has been cleared.`;
            }
          }
        } catch (acceptErr) {
          console.error("Accept settlement tool error:", acceptErr);
          replyText = `❌ Failed to approve settlement: ${acceptErr.message}`;
        }
      }
    } else {
      replyText = result.response.text();
    }

    chatSession.messages.push({ role: 'user', text: message });
    chatSession.messages.push({ role: 'assistant', text: replyText });
    await chatSession.save();

    res.json({ reply: replyText, sessionId: chatSession._id });

  } catch (err) {
    console.error("AI Chat Error:", err);
    res.status(500).json({ message: `AI Error: ${err.message}` });
  }
});

// Get all chat sessions
router.get('/sessions', auth, async (req, res) => {
  try {
    const sessions = await ChatSession.find({ user: req.user.id })
      .select('_id title updatedAt')
      .sort({ updatedAt: -1 });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get specific chat session
router.get('/sessions/:id', auth, async (req, res) => {
  try {
    const session = await ChatSession.findOne({ _id: req.params.id, user: req.user.id });
    if (!session) return res.status(404).json({ message: "Session not found" });
    res.json(session);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete specific chat session
router.delete('/sessions/:id', auth, async (req, res) => {
  try {
    const deleted = await ChatSession.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!deleted) return res.status(404).json({ message: "Session not found" });
    res.json({ message: "Session deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Parse receipt image using Gemini Vision
router.post('/scan-receipt', auth, async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ message: "Image and mimeType are required" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: "AI API key not configured" });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are an expert receipt parser. Look at this receipt image and extract the following information.
You must return the result STRICTLY as a JSON object with no markdown formatting or extra text.
The JSON object must have this exact structure:
{
  "restaurant": "Name of the restaurant (or empty string if not found)",
  "date": "Date of the receipt in YYYY-MM-DD format (or today's date if not found)",
  "time": "Time of the receipt in HH:mm 24-hour format (e.g. 14:30) (or empty string if not found)",
  "amount": Total amount paid as a number (e.g. 450),
  "items": [
    {
      "name": "Name of the food item",
      "calories": Estimated calories for this food item as a number (make your best guess based on the food name)
    }
  ]
}

Ensure the response is ONLY valid JSON.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: mimeType
        }
      }
    ]);

    const responseText = result.response.text().trim();
    // Clean up potential markdown formatting (e.g., ```json ... ```)
    const jsonStr = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    let parsedData;
    try {
      parsedData = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error("Error parsing Gemini JSON response:", responseText);
      return res.status(500).json({ message: "Failed to parse receipt data. Please try again." });
    }

    res.json({ success: true, data: parsedData });
  } catch (err) {
    console.error("Receipt scan error:", err);
    res.status(500).json({ message: "Failed to process receipt image: " + err.message });
  }
});

// GET /api/ai/insights
router.get('/insights', auth, async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: "AI API key not configured" });
    }

    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const forceRefresh = req.query.force === 'true';
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const now = new Date();

    if (
      !forceRefresh &&
      user.profile &&
      user.profile.aiInsights &&
      user.profile.aiInsightsUpdatedAt &&
      (now - new Date(user.profile.aiInsightsUpdatedAt) < SIX_HOURS_MS)
    ) {
      return res.json({
        success: true,
        insight: user.profile.aiInsights,
        updatedAt: user.profile.aiInsightsUpdatedAt,
        cached: true
      });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const logs = await FoodLog.find({
      user: req.user.id,
      date: { $gte: thirtyDaysAgo }
    }).sort({ date: 1 });

    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    let budgetObj = await Budget.findOne({ userId: req.user.id, month: currentMonth, year: currentYear });
    if (!budgetObj) {
      budgetObj = await Budget.findOne({ userId: req.user.id, saveForAllMonths: true }).sort({ createdAt: -1 });
    }
    const budgetAmount = budgetObj ? budgetObj.amount : 0;

    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const currentMonthLogs = logs.filter(log => {
      const logDate = new Date(log.date);
      return logDate >= startOfMonth;
    });
    const spentThisMonth = currentMonthLogs.reduce((sum, log) => sum + (log.amount || 0), 0);
    const totalSpent30Days = logs.reduce((sum, log) => sum + (log.amount || 0), 0);

    let logsSummary = '';
    if (logs.length > 0) {
      const restaurantCounts = {};
      const mealCounts = { Breakfast: 0, Lunch: 0, Dinner: 0, Snack: 0, Snacks: 0 };
      logs.forEach(log => {
        const rest = log.restaurant || 'Home Cooked / Unknown';
        restaurantCounts[rest] = (restaurantCounts[rest] || 0) + 1;
        const meal = log.mealType || 'Unknown';
        if (mealCounts[meal] !== undefined) {
          mealCounts[meal]++;
        }
      });
      
      logsSummary = `In the last 30 days, you logged ${logs.length} meals.
- Spent: ₹${totalSpent30Days} in total.
- Restaurants/Sources: ${Object.entries(restaurantCounts).map(([k, v]) => `${k} (${v} times)`).join(', ')}.
- Meals split: Breakfast (${mealCounts.Breakfast}), Lunch (${mealCounts.Lunch}), Dinner (${mealCounts.Dinner}), Snacks/Snack (${mealCounts.Snack + mealCounts.Snacks}).`;
    } else {
      logsSummary = 'No food logs recorded in the last 30 days.';
    }

    const profile = user.profile || {};
    const gender = profile.gender || 'Unknown';
    const age = profile.age || 'Unknown';
    const weight = profile.weight || 'Unknown';
    const height = profile.height || 'Unknown';
    const goal = profile.goal || 'Unknown';

    const prompt = `You are BiteTrack AI, a health and personal finance budget assistant.
Analyze the user's food logs and spending habits.
Here is the user profile:
- Age: ${age}
- Height: ${height} cm
- Weight: ${weight} kg
- Gender: ${gender}
- Goal: ${goal}

Current month budget status:
- Budget limit: ₹${budgetAmount}
- Spent so far: ₹${spentThisMonth}
- Remaining budget: ₹${budgetAmount - spentThisMonth}

30-day food logging summary:
${logsSummary}

Generate a single, highly personalized AI insight for this user.
Requirements:
1. Provide practical, clear, actionable advice combining health (e.g. weight loss / maintain, meal variety) and budget (e.g. eating out too much, saving tips).
2. It MUST be extremely concise: maximum 2 to 3 sentences (under 220 characters). It must fit inside a small card component on a mobile dashboard.
3. Use a friendly, encouraging, and slightly witty/humorous tone. Don't use markdown headers or lists, just plain text. Do not invent any new numbers or fake stats. Do not include introductory text like "Here is your insight:".
4. If they have no logs, encourage them to start logging their meals to get personalized insights.`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(prompt);
    const insightText = result.response.text().trim();

    user.profile.aiInsights = insightText;
    user.profile.aiInsightsUpdatedAt = now;
    await user.save();

    res.json({
      success: true,
      insight: insightText,
      updatedAt: now,
      cached: false
    });

  } catch (err) {
    console.error("AI Insights Endpoint Error:", err);
    res.status(500).json({ message: `AI Insights Error: ${err.message}` });
  }
});

module.exports = router;
