const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const FoodLog = require('../models/FoodLog');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configure Google OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/ledger` : 'http://localhost:5173/ledger' // Assuming user links from ledger
);

// We will use the frontend to handle the callback to make it smoother for SPA
// Actually, it's easier if we redirect back to the frontend with the code, 
// and the frontend sends the code to the backend.

// Endpoint 1: Generate Auth URL
router.get('/google/url', auth, (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Required to get a refresh token
    prompt: 'consent', // Force consent screen to guarantee refresh token
    scope: ['https://www.googleapis.com/auth/gmail.readonly']
  });
  res.json({ url });
});

// Endpoint 2: Handle OAuth Callback Code from Frontend
router.post('/google/callback', auth, async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) return res.status(400).json({ message: "No code provided" });

    // Ensure redirectUri matches what the frontend used to generate the Google auth popup/redirect
    const tempClient = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri || (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/ledger` : 'http://localhost:5173/ledger')
    );

    const { tokens } = await tempClient.getToken(code);
    
    // Save tokens to user safely
    const user = await User.findById(req.user.id);
    user.gmailSyncTokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date
    };
    await user.save();

    res.json({ success: true, message: "Gmail linked successfully!" });
  } catch (err) {
    console.error("Gmail OAuth error:", err);
    res.status(500).json({ message: "Failed to link Gmail" });
  }
});

// Endpoint 3: Disconnect Gmail
router.post('/google/disconnect', auth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      $unset: { gmailSyncTokens: 1, lastEmailSyncDate: 1 }
    });
    res.json({ success: true, message: "Gmail disconnected" });
  } catch (err) {
    res.status(500).json({ message: "Failed to disconnect Gmail" });
  }
});

// Endpoint 4: Trigger Manual Sync
router.post('/sync-emails', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user.gmailSyncTokens || !user.gmailSyncTokens.access_token) {
      return res.status(400).json({ message: "Gmail not connected" });
    }

    // Set credentials
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    client.setCredentials(user.gmailSyncTokens);

    // When the tokens refresh, save them back to the DB
    client.on('tokens', async (tokens) => {
      if (tokens.refresh_token) {
        user.gmailSyncTokens.refresh_token = tokens.refresh_token;
      }
      user.gmailSyncTokens.access_token = tokens.access_token;
      user.gmailSyncTokens.expiry_date = tokens.expiry_date;
      await user.save();
    });

    const gmail = google.gmail({ version: 'v1', auth: client });

    // Determine query: Swiggy or Zomato receipts
    // Usually subjects contain "Order summary" or "Your order"
    // And from addresses are specific
    const query = '(from:noreply@zomato.com OR from:swiggy@swiggy.in OR from:noreply@swiggy.in) (subject:"Order" OR subject:"Receipt" OR subject:"Summary")';
    
    // Fetch last 50 messages that match
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50
    });

    const messages = response.data.messages || [];
    if (messages.length === 0) {
      return res.json({ success: true, newOrders: 0, message: "No new food orders found in Gmail." });
    }

    // Process only emails we haven't seen before, or just process the newest one for now
    let newOrdersCount = 0;
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    for (let msg of messages) {
      // Check if we already processed this email ID (you could add an 'emailId' array to User schema to track this, 
      // but for testing we will just parse it and check if an order exists with similar date/amount)
      
      const msgData = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full'
      });

      // Extract raw text from email payload
      let emailText = "";
      const extractText = (parts) => {
        for (let part of parts) {
          if (part.mimeType === 'text/plain') {
            emailText += Buffer.from(part.body.data, 'base64').toString('utf-8');
          } else if (part.parts) {
            extractText(part.parts);
          }
        }
      };

      if (msgData.data.payload.parts) {
        extractText(msgData.data.payload.parts);
      } else if (msgData.data.payload.body.data) {
        emailText = Buffer.from(msgData.data.payload.body.data, 'base64').toString('utf-8');
      }

      if (!emailText.trim()) continue;

      // Use Gemini to extract data
      const prompt = `You are an expert receipt parser. Extract the food order details from this raw email text.
You must return the result STRICTLY as a JSON object.
Structure:
{
  "restaurant": "Restaurant name",
  "date": "YYYY-MM-DD",
  "time": "HH:mm 24-hour",
  "amount": Total amount paid (number),
  "items": [{ "name": "Item name", "calories": estimated calories (number) }]
}
If this email is NOT a valid food order receipt, return { "invalid": true }.

Email Text:
${emailText.substring(0, 5000)}
`;

      try {
        const result = await model.generateContent(prompt);
        const jsonStr = result.response.text().replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();
        
        const parsed = JSON.parse(jsonStr);
        if (parsed.invalid || !parsed.restaurant || !parsed.amount) continue;

        // Check for duplicate in DB
        const existing = await FoodLog.findOne({
          user: req.user.id,
          amount: parsed.amount,
          restaurant: new RegExp(parsed.restaurant, 'i')
        });

        // If not a duplicate, save it!
        if (!existing) {
          const newLog = new FoodLog({
            user: req.user.id,
            date: parsed.date ? new Date(parsed.date) : new Date(),
            time: parsed.time || "12:00",
            mealType: "Dinner", // Default fallback
            restaurant: parsed.restaurant,
            amount: parsed.amount,
            items: parsed.items || [],
            notes: "Automatically synced from Gmail."
          });
          await newLog.save();
          newOrdersCount++;
        }
      } catch (aiErr) {
        console.error("Failed to process email with AI:", aiErr.message);
      }
    }

    res.json({ success: true, newOrders: newOrdersCount, message: `Successfully synced ${newOrdersCount} new orders!` });
  } catch (err) {
    console.error("Email sync error:", err);
    res.status(500).json({ message: "Failed to sync emails: " + err.message });
  }
});

module.exports = router;
