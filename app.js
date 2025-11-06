const express = require('express');
const argon2 = require('@node-rs/argon2');
const con = require('./db');


const app = express();
app.use(express.json());



//================== Logout and Search Bar ==================//
// Session Configuration
// ----------------------
app.use(session({
  secret: 'room_booking_secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } //true =HTTPS
}));

// ----------------------
// Logout Route
// ----------------------
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ message: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logout successful' });
  });
});

// ----------------------
//  Search Room Route
// ----------------------
app.get('/search', (req, res) => {
  const searchQuery = req.query.q ? req.query.q.trim() : '';

  const sql = `
    SELECT room_id, room_name, room_type, room_status
    FROM room
    WHERE room_status = 'enable'
    AND (room_name LIKE ? OR room_type LIKE ?)
  `;

  db.query(sql, [`%${searchQuery}%`, `%${searchQuery}%`], (err, results) => {
    if (err) {
      console.error('Database query error:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json(results);
  });
});



//=================== Starting server =======================
const port = 3000;
app.listen(port, () => {
    console.log('Server is running at ' + port);
});
