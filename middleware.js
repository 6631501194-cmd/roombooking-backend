const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-super-secure-and-long-random-string-12345';

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; 

  if (!token) {
    return res.status(401).json({ message: 'Error: No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Error: Invalid or expired token.' });
    req.user = user;
    next();
  });
}

module.exports = { verifyToken, JWT_SECRET };
