const express = require('express');
const argon2 = require('@node-rs/argon2');
const jwt = require('jsonwebtoken');
const con = require('./db');
const { JWT_SECRET } = require('./middleware');

const router = express.Router();

router.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  const sql = "SELECT user_id, email, password, role, username FROM user WHERE email = ?";
  con.query(sql, [email], (err, result) => {
    if (err) return res.status(500).send("Database server error");
    if (result.length !== 1) return res.status(401).send("Invalid email");

    const user = result[0];
    const passwordMatch = argon2.verifySync(user.password, password);

    if (!passwordMatch) return res.status(401).send("Wrong password");

    const tokenPayload = { 
      userId: user.user_id, 
      role: user.role, 
      username: user.username 
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      uid: user.user_id,
      email: user.email,
      username: user.username,
      role: user.role,
      token
    });
  });
});

module.exports = router;
