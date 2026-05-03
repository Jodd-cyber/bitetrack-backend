console.log("=== OAUTH CONFIG ===");
console.log("CLIENT ID:", process.env.GOOGLE_CLIENT_ID);
console.log("CLIENT SECRET:", process.env.GOOGLE_CLIENT_SECRET ? "[SET]" : "[MISSING]");
console.log("NODE_ENV:", process.env.NODE_ENV);
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User"); // adjust path if needed

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const backendBaseUrl = process.env.NODE_ENV === "production"
  ? "https://bitetrack-backend-yfkf.onrender.com"
  : (process.env.BACKEND_URL || "http://localhost:5000");
const googleCallbackUrl = `${backendBaseUrl}/api/auth/google/callback`;
const githubCallbackUrl = `${backendBaseUrl}/api/auth/github/callback`;
console.log("GOOGLE CALLBACK URL:", googleCallbackUrl);
console.log("=== END CONFIG ===");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: googleCallbackUrl,
    },
    async (accessToken, refreshToken, profile, done) => {
      console.log("[Google Strategy] Profile received:", profile.emails ? profile.emails[0].value : "no email");
  try {
    const email = profile.emails && profile.emails[0] && profile.emails[0].value
      ? profile.emails[0].value.toLowerCase()
      : null;

    if (!email) {
      return done(new Error("Google profile did not include an email address"));
    }

    let user = await User.findOne({
      email: { $regex: `^${escapeRegex(email)}$`, $options: "i" }
    });

    if (!user) {
      user = await User.create({
        name: profile.displayName || "Google User",
        email,
        password: "google-auth"
      });
    }

    return done(null, user);
  } catch (err) {
    return done(err, null);
  }
}
  )
);

// Required for session
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});

const GitHubStrategy = require("passport-github2").Strategy;

passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: githubCallbackUrl,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // GitHub may not always give email directly
        const email =
          profile.emails && profile.emails.length > 0
            ? profile.emails[0].value
            : `${profile.username}@github.com`;

        let user = await User.findOne({ email });

        if (!user) {
          user = await User.create({
            name: profile.displayName || profile.username,
            email,
            password: "github-auth"
          });
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);