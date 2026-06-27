const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    profile: {
      age: { type: Number },
      height: { type: Number }, // in cm
      weight: { type: Number }, // in kg
      gender: { type: String, enum: ['male', 'female', 'other', ''] },
      goal: { type: String, enum: ['lose', 'maintain', 'gain', ''] },
      avatar: { type: String },
      aiInsights: { type: String },
      aiInsightsUpdatedAt: { type: Date },
      dietPlan: {
        breakfast: { name: String, calories: Number },
        lunch: { name: String, calories: Number },
        dinner: { name: String, calories: Number },
        snack: { name: String, calories: Number }
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
    pushToken: { type: String, default: "" }
  },
  { timestamps: true }
);



module.exports = mongoose.model("User", userSchema);