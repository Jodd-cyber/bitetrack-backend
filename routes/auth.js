const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const jwt = require('jsonwebtoken');
const passport = require("passport");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";


const router = express.Router();

// SIGNUP ROUTE
// SIGNUP ROUTE
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();

    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email, password are required" });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      // If this account was created via OAuth (no local password), allow setting one.
      if (!existingUser.password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        existingUser.password = hashedPassword;
        if (name && !existingUser.name) {
          existingUser.name = name;
        }
        await existingUser.save();

        return res.status(200).json({
          message: "Password set successfully. You can now sign in with email and password.",
          user: { id: existingUser._id, name: existingUser.name, email: existingUser.email },
        });
      }

      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: normalizedEmail,
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
    const normalizedEmail = email?.toLowerCase().trim();

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      console.log(`Login attempt for non-existent email: ${email}`);
      return res.status(400).json({ message: "Invalid email or password" });
    }

    if (!user.password) {
      return res.status(400).json({
        message: "This account currently uses social login only. Set a password from Sign Up with the same email or use Forgot Password.",
      });
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
    const normalizedEmail = email?.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.json({ message: "If email exists, reset link sent" });
    }

    const crypto = require("crypto");
    const resetToken = crypto.randomBytes(32).toString("hex");

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    const resetLink = `${FRONTEND_URL}/reset-password/${resetToken}`;

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

const redirectToSignin = (res, error) => {
  return res.redirect(`${FRONTEND_URL}/signin?error=${error}`);
};

const completeOAuthLogin = async (req, res, providerName) => {
  try {
    const user = req.user;

    if (!user) {
      console.error(`❌ ${providerName} OAuth completed without a user`);
      return redirectToSignin(res, `${providerName.toLowerCase()}_no_user`);
    }

    if (!user._id || !user.name || !user.email) {
      console.error(`❌ ${providerName} OAuth user is missing required fields`, user);
      return redirectToSignin(res, `${providerName.toLowerCase()}_invalid_user`);
    }

    const token = jwt.sign(
      {
        userId: user._id,
        name: user.name,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.redirect(`${FRONTEND_URL}/oauth-success?token=${token}`);
  } catch (err) {
    console.error(`❌ ${providerName} OAuth token generation failed:`, err);
    return redirectToSignin(res, `${providerName.toLowerCase()}_token_failed`);
  }
};


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
    failureRedirect: `${FRONTEND_URL}/signin?error=google_auth_failed`,
  }),
  (req, res) => completeOAuthLogin(req, res, "Google")
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
    failureRedirect: `${FRONTEND_URL}/signin?error=github_auth_failed`,
  }),
  (req, res) => completeOAuthLogin(req, res, "GitHub")
);




module.exports = router;


