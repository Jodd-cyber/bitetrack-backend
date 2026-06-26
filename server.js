require("dotenv").config();
require("./config/passport");
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");    

const authRoutes = require("./routes/auth");
const foodlogRoutes = require("./routes/foodlogs");
const feedbackRoutes = require("./routes/feedbackRoutes");
const budgetRoutes = require("./routes/budget");
const app = express();

app.set("trust proxy", 1); // ✅ MUST BE HERE (top, before routes)

// Middleware
app.use(express.json({ limit: '10mb' }));

app.use(cors({
  origin: function (origin, callback) {
    callback(null, true); // Allow all origins for now to prevent CORS issues on Vercel preview URLs
  },
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

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "bitetrack-backend" });
});

app.use("/api/auth", authRoutes);
app.use("/api/foodlogs", foodlogRoutes);
app.use("/api/user", require("./routes/user"));
app.use("/api/feedback", feedbackRoutes);
app.use("/api/budget", budgetRoutes);
app.use("/api/ai", require("./routes/ai"));
app.use("/api/integrations", require("./routes/integrations"));
app.use("/api/groups", require("./routes/groups"));
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
