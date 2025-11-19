const express = require('express');
const multer = require('multer');
const con = require('./db');
const { verifyToken } = require('./middleware');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// POST /api/rooms
router.post('/api/rooms', verifyToken, upload.single('image'), (req, res) => {
  const { room_name, room_type } = req.body;
  const img = req.file?.buffer;

  if (!room_name || !room_type || !img)
    return res.status(400).json({ message: 'Missing fields' });

  const sql = `INSERT INTO room (room_name, room_type, room_status, image) VALUES (?, ?, 'enable', ?)`;
  con.query(sql, [room_name, room_type, img], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json({ message: 'Room added', roomId: result.insertId });
  });
});

// PUT /api/rooms/:roomId
router.put('/api/rooms/:roomId', verifyToken, upload.single('image'), (req, res) => {
  const { roomId } = req.params;
  const { room_name, room_type } = req.body;

  let sql, params;
  if (req.file) {
    sql = "UPDATE room SET room_name=?, room_type=?, image=? WHERE room_id=?";
    params = [room_name, room_type, req.file.buffer, roomId];
  } else {
    sql = "UPDATE room SET room_name=?, room_type=? WHERE room_id=?";
    params = [room_name, room_type, roomId];
  }

  con.query(sql, params, (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!result.affectedRows) return res.status(404).json({ message: 'Room not found' });
    res.json({ message: 'Room updated' });
  });
});

// PUT /api/rooms/:roomId/status
router.put('/api/rooms/:roomId/status', verifyToken, (req, res) => {
  const { roomId } = req.params;
  const { status } = req.body;

  if (!['enable', 'disable'].includes(status))
    return res.status(400).json({ message: 'Invalid status' });

  con.query("UPDATE room SET room_status=? WHERE room_id=?", [status, roomId], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!result.affectedRows) return res.status(404).json({ message: 'Room not found' });
    res.json({ message: 'Status updated' });
  });
});

module.exports = router;
