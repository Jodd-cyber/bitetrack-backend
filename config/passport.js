const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/api/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Extract user info
        const email = profile.emails[0].value;
        const name = profile.displayName;

        // Check if user exists
        let user = await User.findOne({ email });

        if (!user) {
          // Create new user
          user = await User.create({
            name,
            email,
            password: null, 
            provider: "google" // since OAuth user
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
      callbackURL: "/api/auth/github/callback",
      scope: ["user:email"], // 🔥 important to get email
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // 🔥 GitHub may not return email directly
        let email = profile.emails?.[0]?.value;

        // fallback if email missing
        if (!email) {
          email = `${profile.username}@github.com`;
        }

        const name = profile.displayName || profile.username;

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

module.exports = passport;