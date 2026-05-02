require("dotenv").config();
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");
const express = require("express");
const cors = require("cors"); // ADD THIS
const passport = require("passport");
const session = require("express-session");
require("./config/passport");

const app = express();
app.get("/", (req, res) => {
  res.send("BiteTrack API is running 🚀");
});
app.use(express.json());
// ADD CORS MIDDLEWARE BEFORE OTHER MIDDLEWARE
app.use(cors({
  origin: 'http://localhost:5173', // Your frontend URL
  credentials: true
}));

app.use("/auth", require("./routes/auth"));
app.use(express.json());
app.use("/api/auth", authRoutes);
// add near other requires
const foodlogRoutes = require('./routes/foodlogs');

// add after app.use("/api/auth", authRoutes);
app.use('/api/foodlogs', foodlogRoutes);

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  }
}

connectDB();

app.get("/", (req, res) => {
  res.send("BiteTrack backend is running. Try GET /health");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "bitetrack-backend" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const feedbackRoutes = require("./routes/feedbackRoutes");

app.use("/api/feedback", feedbackRoutes);