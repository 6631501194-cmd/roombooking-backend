//auth.js
const express = require('express');
const router = express.Router();
const argon2 = require('@node-rs/argon2');
const con = require('../db');

//create account
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
        return res.status(400).json({ status: 'error', message: 'Missing fields' });

    try {
        const hashedPassword = await argon2.hash(password);

        const sql = 'INSERT INTO user (username, email, password) VALUES (?, ?, ?)';
        con.query(sql, [username, email, hashedPassword], (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ status: 'error', message: 'Database error' });
            }
            res.json({ status: 'success', message: 'User registered successfully' });
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal error' });
    }
});

//login 
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ status: 'error', message: 'Missing fields' });

    const sql = 'SELECT * FROM user WHERE email = ?';
    con.query(sql, [email], async (err, results) => {
        if (err) return res.status(500).json({ status: 'error', message: 'Database error' });
        if (results.length === 0)
            return res.status(404).json({ status: 'error', message: 'User not found' });

        const user = results[0];
        const passwordMatch = await argon2.verify(user.password, password);

        if (!passwordMatch)
            return res.status(401).json({ status: 'error', message: 'Invalid password' });

        res.json({
            status: 'success',
            message: 'Login successful',
            user: {
                id: user.user_id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });
    });
});

module.exports = router;
