const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    profile: {
      age: { type: Number, default: 0 },
      height: { type: Number, default: 0 }, // in cm
      weight: { type: Number, default: 0 }, // in kg
      gender: { type: String, enum: ['male', 'female', 'other', ''], default: '' },
      goal: { type: String, enum: ['lose', 'maintain', 'gain', ''], default: '' },
      avatar: { type: String, default: '🍕' },
      upiId: { type: String, default: "" },
      aiAssistant: {
        name: { type: String, default: "AI Assistant" },
        personality: { type: String, enum: ['normal', 'drill', 'coach', 'chef', ''], default: 'normal' },
        orbTheme: { type: String, default: 'emerald' }
      },
      aiInsights: { type: String },
      aiInsightsUpdatedAt: { type: Date },
      dietPlan: {
        isWeekly: { type: Boolean, default: false },
        daily: {
          breakfast: { name: String, calories: Number },
          lunch: { name: String, calories: Number },
          dinner: { name: String, calories: Number },
          snack: { name: String, calories: Number }
        },
        weekly: {
          monday: {
            breakfast: { name: String, calories: Number },
            lunch: { name: String, calories: Number },
            dinner: { name: String, calories: Number },
            snack: { name: String, calories: Number }
          },
          tuesday: {
            breakfast: { name: String, calories: Number },
            lunch: { name: String, calories: Number },
            dinner: { name: String, calories: Number },
            snack: { name: String, calories: Number }
          },
          wednesday: {
            breakfast: { name: String, calories: Number },
            lunch: { name: String, calories: Number },
            dinner: { name: String, calories: Number },
            snack: { name: String, calories: Number }
          },
          thursday: {
            breakfast: { name: String, calories: Number },
            lunch: { name: String, calories: Number },
            dinner: { name: String, calories: Number },
            snack: { name: String, calories: Number }
          },
          friday: {
            breakfast: { name: String, calories: Number },
            lunch: { name: String, calories: Number },
            dinner: { name: String, calories: Number },
            snack: { name: String, calories: Number }
          },
          saturday: {
            breakfast: { name: String, calories: Number },
            lunch: { name: String, calories: Number },
            dinner: { name: String, calories: Number },
            snack: { name: String, calories: Number }
          },
          sunday: {
            breakfast: { name: String, calories: Number },
            lunch: { name: String, calories: Number },
            dinner: { name: String, calories: Number },
            snack: { name: String, calories: Number }
          }
        }
      }
    },
    gmailSyncTokens: {
      access_token: String,
      refresh_token: String,
      scope: String,
      token_type: String,
      expiry_date: Number
    },
    lastEmailSyncDate: Date,
    processedEmailIds: { type: [String], default: [] },
    pushToken: { type: String, default: "" }
  },
  { timestamps: true }
);



module.exports = mongoose.model("User", userSchema);