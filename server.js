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
    "https://bitetrack-frontenddd.vercel.app",
    "https://bitetrack-frontendd-git-main-batraakshat25-5082s-projects.vercel.app",
    "https://bitetrack-frontendd-nk3t58d9f-batraakshat25-5082s-projects.vercel.app",
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

// Global error handler — convert unexpected errors into friendly redirects for OAuth flows
// This prevents the browser from showing chrome-error:// pages during OAuth redirects.
app.use((err, req, res, next) => {
  console.error("Global error handler:", err && err.stack ? err.stack : err);

  const frontend = process.env.FRONTEND_URL || "http://localhost:5173";

  // If the request was for an auth callback, redirect the user back to sign-in with an error
  if (req && req.originalUrl && req.originalUrl.startsWith("/api/auth")) {
    try {
      return res.redirect(`${frontend}/signin?error=server_error`);
    } catch (e) {
      // fallback to JSON
      return res.status(500).json({ message: "Server error" });
    }
  }

  // Generic API error response for other routes
  if (req && req.originalUrl && req.originalUrl.startsWith("/api/")) {
    return res.status(500).json({ message: "Server error" });
  }

  // For non-API requests, just show a generic error
  res.status(500).send("Server error");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
