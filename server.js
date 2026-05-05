require("dotenv").config();
require("./config/passport");
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const foodlogRoutes = require("./routes/foodlogs");
const feedbackRoutes = require("./routes/feedbackRoutes");

const app = express();

app.set("trust proxy", 1); // ✅ MUST BE HERE (top, before routes)

// Middleware
app.use(express.json());

app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://bitetrack-frontend.onrender.com",
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true
}));

const passport = require("passport");
app.use(passport.initialize());

// Routes
app.get("/", (req, res) => {
  res.json({ message: "BiteTrack API is running 🚀" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "bitetrack-backend" });
});

app.use("/api/auth", authRoutes);
app.use("/api/foodlogs", foodlogRoutes);
app.use("/api/user", require("./routes/user"));
app.use("/api/feedback", feedbackRoutes);
const budgetRoutes = require("./routes/budget");
app.use("/api/budget", budgetRoutes);
// DB Connection
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

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
