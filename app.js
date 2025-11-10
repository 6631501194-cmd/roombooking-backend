const express = require('express');
const con = require('./db');

const app = express();
app.use(express.json());

// ================== LECTURER: SEARCH ROOMS ==================
app.get('/api/lecturer/rooms', (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : '%';

  const sql = `
    SELECT room_id, room_name, room_type, room_status
    FROM room
    WHERE room_name LIKE ?
    ORDER BY room_id ASC
  `;

  con.query(sql, [search], (err, rows) => {
    if (err) return res.status(500).send("Database server error");

    const data = rows.map(r => ({
      room_id: r.room_id,
      room_name: r.room_name,
      room_type: r.room_type,
      room_status: r.room_status,
      image_url: `/api/lecturer/rooms/${r.room_id}/image`
    }));
    res.json(data);
  });
});

// ================== LECTURER: ROOM IMAGE ==================
app.get('/api/lecturer/rooms/:roomId/image', (req, res) => {
  const roomId = req.params.roomId;

  const sql = "SELECT image FROM room WHERE room_id = ?";
  con.query(sql, [roomId], (err, rows) => {
    if (err) return res.status(500).send("Database server error");
    if (rows.length !== 1 || !rows[0].image) return res.status(404).send("Image not found");

    res.setHeader("Content-Type", "image/jpeg");
    res.send(rows[0].image);
  });
});


// ================== LECTURER: GET ROOM SLOTS ==================
app.get('/api/lecturer/rooms/:roomId/slots', (req, res) => {
  const roomId = req.params.roomId;

  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).send("Database server error");

    const sql = `
      SELECT
        ts.slot_id,
        DATE_FORMAT(ts.start_time, '%H:%i') AS startTime,
        DATE_FORMAT(ts.end_time,   '%H:%i') AS endTime,
        b.booking_status
      FROM time_slot ts
      LEFT JOIN booking b
        ON b.room_id = ?
       AND b.slot_id = ts.slot_id
       AND DATE(b.booking_datetime) = CURDATE()
       AND b.booking_status IN ('pending','reserved')
      ORDER BY ts.start_time ASC;
    `;

    con.query(sql, [roomId], (err, rows) => {
      if (err) return res.status(500).send("Database server error");

      const data = rows.map(s => ({
        slotId: s.slot_id,
        time: `${s.startTime}-${s.endTime}`,
        status: s.booking_status ? s.booking_status.toLowerCase() : 'available'
      }));

      res.json(data);
    });
  });
});


// ================== SERVER START ==================
const port = 3001; // 
app.listen(port, () => {
  console.log(`Lecturer server running at port ${port}`);
});
