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
      goal: { type: String, enum: ['lose', 'maintain', 'gain', ''] }
    },
    gmailSyncTokens: {
      access_token: String,
      refresh_token: String,
      scope: String,
      token_type: String,
      expiry_date: Number
    },
    lastEmailSyncDate: Date,
    lastBudgetAlertMonth: String,
    remindersEnabled: { type: Boolean, default: true }
  },
  { timestamps: true }
);



module.exports = mongoose.model("User", userSchema);