const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${BACKEND_URL}/api/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const rawEmail = profile.emails?.[0]?.value;

        if (!rawEmail) {
          return done(new Error("No email from Google"), null);
        }

        const email = rawEmail.toLowerCase().trim();
        const name = (profile.displayName || profile.username || "").trim();

        let user = await User.findOne({ email });

        if (!user) {
          user = await User.create({
            name,
            email,
            password: null,
            provider: "google",
          });
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);


const GitHubStrategy = require("passport-github2").Strategy;

passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: `${BACKEND_URL}/api/auth/github/callback`,
      scope: ["user:email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // 🔥 GitHub may not return email directly
        let rawEmail = profile.emails?.[0]?.value;

        // fallback if email missing
        if (!rawEmail) {
          return done(new Error("GitHub email not available"), null);
        }

        const email = rawEmail.toLowerCase().trim();
        const name = (profile.displayName || profile.username || "").trim();

        let user = await User.findOne({ email });

        if (!user) {
          user = await User.create({
            name,
            email,
            password: null,
            provider: "github",
          });
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// ✅ REQUIRED: Passport serialization methods
// Even with session: false, these must be defined for Passport to work
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser((id, done) => {
  User.findById(id)
    .then((user) => {
      done(null, user);
    })
    .catch((err) => {
      done(err, null);
    });
});

module.exports = passport;