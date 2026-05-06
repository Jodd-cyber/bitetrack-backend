const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  try {
    let token;

    // Check header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from DB
      const user = await User.findById(decoded.userId).select("-password");

      // 🔥 CRITICAL FIX
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "User not found",
        });
      }

      // Attach user to request
      req.user = user;

      next();
    } else {
      return res.status(401).json({
        success: false,
        message: "Not authorized, no token",
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(401).json({
      success: false,
      message: "Token failed",
    });
  }
};

module.exports = { protect };