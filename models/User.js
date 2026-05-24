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
    }
  },
  { timestamps: true }
);



module.exports = mongoose.model("User", userSchema);