const express = require('express');
const argon2 = require('@node-rs/argon2');
const con = require('./db');

const router = express.Router();

router.post('/api/register', async (req, res) => {
  const { email, username, password, role } = req.body;

  if (!email || !username || !password)
    return res.status(400).send("Missing required fields");

  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9]+\.[a-zA-Z]+$/;
  if (!emailRegex.test(email)) return res.status(400).send("Invalid email format");

  try {
    con.query("SELECT user_id FROM user WHERE email = ?", [email], async (err, rows) => {
      if (err) return res.status(500).send("Database server error");
      if (rows.length > 0) return res.status(409).send("Email already registered");

      const hashedPassword = await argon2.hash(password);

      const sql = `
        INSERT INTO user (email, username, password, role, createdAt)
        VALUES (?, ?, ?, ?, NOW())
      `;
      con.query(sql, [email, username, hashedPassword, role || "student"], (err, result) => {
        if (err) return res.status(500).send("Database server error");
        res.json({ message: "User registered successfully", userId: result.insertId });
      });
    });
  } catch (error) {
    res.status(500).send("Server error");
  }
});

module.exports = router;
