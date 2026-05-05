const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const jwt = require('jsonwebtoken');
const passport = require("passport");
const sendEmail = require("../utils/sendEmail");


const router = express.Router();

// SIGNUP ROUTE
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
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log(`Login attempt for non-existent email: ${email}`);
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log(`Login failed: incorrect password for ${email}`);
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      {
        userId: user._id,
        name: user.name,
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
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
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});




const crypto = require("crypto");

router.post("/forgot-password", async (req, res) => {
  console.log("🔥 route hit");

  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ message: "If email exists, reset link sent" });
    }

    const crypto = require("crypto");
    const resetToken = crypto.randomBytes(32).toString("hex");

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    const resetLink = `http://localhost:5173/reset-password/${resetToken}`;

    const sendEmail = require("../utils/sendEmail");

    try {
      console.log("📧 About to send email...");

      await sendEmail(
        email,
        "Reset your BiteTrack password",
        `
          <h2>Password Reset</h2>
          <a href="${resetLink}">Reset Password</a>
        `
      );

      console.log("✅ Email sent");

      return res.json({
        success: true,
        message: "Reset link sent to your email",
      });

    } catch (err) {
      console.error("❌ Email failed:", err);

      return res.status(500).json({
        success: false,
        message: "Failed to send email",
      });
    }

  } catch (err) {
    console.error("ERROR:", err);

    return res.status(500).json({
      message: "Server error",
    });
  }
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


router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "http://localhost:5173/signin"
  }),
  async (req, res) => {
    try {
      

      const user = req.user;

      // Generate JWT (same as your login)
      const token = jwt.sign(
        {
          userId: user._id,
          name: user.name,
          email: user.email,
        },
        process.env.JWT_SECRET,
        { expiresIn: "2h" }
      );

      // Redirect to frontend with token
      const frontendURL = "http://localhost:5173";

      res.redirect(`${frontendURL}/oauth-success?token=${token}`);
    } catch (err) {
      console.error(err);
      res.redirect("/login");
    }
  }
);


router.get(
  "/github",
  passport.authenticate("github", {
    scope: ["user:email"],
    session: false,
  })
);



router.get(
  "/github/callback",
  passport.authenticate("github", {
    session: false,
    failureRedirect: "http://localhost:5173/signin",
  }),
  async (req, res) => {
    try {
      const user = req.user;

      const token = jwt.sign(
        {
          userId: user._id,
          name: user.name,
          email: user.email,
        },
        process.env.JWT_SECRET,
        { expiresIn: "2h" }
      );

      // 🔥 redirect to frontend (same as Google)
      res.redirect(`http://localhost:5173/oauth-success?token=${token}`);
    } catch (err) {
      console.error(err);
      res.redirect("http://localhost:5173/signin");
    }
  }
);




module.exports = router;


