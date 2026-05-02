const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // support both token shapes used by the app
    const userId = payload.id || payload.userId;
    if (!userId) {
  return res.status(401).json({ message: "Invalid token payload" });
}

req.user = {
  id: userId,
  name: payload.name || "",
  email: payload.email || "",
};
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token invalid or expired' });
  }
};

