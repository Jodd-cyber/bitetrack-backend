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

module.exports = passport;