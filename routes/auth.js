const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const jwt = require('jsonwebtoken');
const passport = require("passport");



const router = express.Router();

const getFrontendUrl = () =>
  (process.env.FRONTEND_URL || "https://bitetrack-frontend.onrender.com").replace(/\/$/, "");

// SIGNUP ROUTE
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email, password are required" });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
    });

    return res.status(201).json({
      message: "User created",
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

// LOGIN ROUTE
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res.status(400).json({ message: "Invalid email or password" });
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(400).json({ message: "Invalid email or password" });
  }
  const token = jwt.sign(
  {
    userId: user._id,
    name: user.name,       // ✅ ADD THIS
    email: user.email      // (optional)
  },// payload, you can add more properties if needed later
  process.env.JWT_SECRET,
  { expiresIn: '2h' } // token is valid for 2 hours
);
  res.json({
  message: "Login successful!",
  user: {
    id: user._id,
    name: user.name,
    email: user.email
  },
  token
});
});




// GOOGLE LOGIN
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// GOOGLE CALLBACK
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false }),
  (req, res) => {
    const user = req.user;

    const token = jwt.sign(
  {
    userId: user._id,
    name: user.name,        // ✅ ADD THIS
    email: user.email
  },
  process.env.JWT_SECRET,
  { expiresIn: "2h" }
);

    const frontendUrl = getFrontendUrl();
    res.redirect(`${frontendUrl}/oauth-success?token=${encodeURIComponent(token)}`);
  }
);


// GITHUB LOGIN
router.get(
  "/github",
  passport.authenticate("github", { scope: ["user:email"] })
);

// GITHUB CALLBACK
router.get(
  "/github/callback",
  passport.authenticate("github", { session: false }),
  (req, res) => {
    const user = req.user;

    const token = jwt.sign(
      {
        userId: user._id,
        name: user.name,
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    const frontendUrl = getFrontendUrl();
    res.redirect(`${frontendUrl}/oauth-success?token=${encodeURIComponent(token)}`);
  }
);


const crypto = require("crypto");

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  // 1. Find user
  const user = await User.findOne({ email });
  if (!user) {
    return res.json({ message: "If email exists, reset link sent" });
  }

  // 2. Generate token
  const resetToken = crypto.randomBytes(32).toString("hex");

  // 3. Save token + expiry in DB
  user.resetPasswordToken = resetToken;
  user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 min
  await user.save();

  // 4. TEMP: print link instead of email
  const resetLink = `http://localhost:5173/reset-password/${resetToken}`;

  const sendEmail = require("../utils/sendEmail");

await sendEmail(
  email, // send to user
  "Reset your BiteTrack password",
  `
    <h2>Password Reset</h2>
    <p>You requested to reset your password.</p>
    <p>Click the link below:</p>
    
    <a href="${resetLink}" style="color: blue;">
      Reset Password
    </a>

    <p>If you didn’t request this, ignore this email.</p>
    <p>This link expires in 15 minutes.</p>
  `
);

  res.json({
    success: true,
    message: "Reset link generated (check backend console)",
  });
});




router.post("/reset-password/:token", async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  // 1. Find user with token + not expired
  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  // 2. Hash new password
  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(password, salt);

  // 3. Clear reset fields
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;

  await user.save();

  res.json({
    success: true,
    message: "Password updated successfully",
  });
});

module.exports = router;


