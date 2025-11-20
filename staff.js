const express = require('express');
const multer = require('multer');
const con = require('./db');
const { verifyToken } = require('./middleware');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// POST /api/rooms
// Modified POST /api/rooms handler: return 201 on success
router.post('/api/rooms', verifyToken, upload.single('image'), (req, res) => {
  const { room_name, room_type } = req.body;
  const img = req.file?.buffer;

  if (!room_name || !room_type || !img)
    return res.status(400).json({ message: 'Missing fields' });

  const sql = `INSERT INTO room (room_name, room_type, room_status, image) VALUES (?, ?, 'enable', ?)`;
  con.query(sql, [room_name, room_type, img], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    // Return 201 Created for a new resource
    res.status(201).json({ message: 'Room added', roomId: result.insertId });
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

//api/staff/history - View ALL booking history (Reserved/Rejected)
router.get('/api/staff/history', verifyToken, (req, res) => {
    con.query("SET time_zone = '+07:00'", (tzErr) => {
        if (tzErr) return res.status(500).json({ message: 'Database server error' });

        const sql = `
            SELECT 
                b.booking_id,
                b.booking_status,
                b.reject_reason,
                DATE_FORMAT(b.booking_datetime, '%b %d, %Y') AS bookingDate,
                r.room_id,
                r.room_name,
                r.room_type,
                DATE_FORMAT(ts.start_time, '%H:%i') AS startTime,
                DATE_FORMAT(ts.end_time,   '%H:%i') AS endTime,
                u.username AS requesterName,
                a.username AS approverName
            FROM booking b
            JOIN room r ON b.room_id = r.room_id
            JOIN time_slot ts ON b.slot_id = ts.slot_id
            JOIN user u ON b.user_id = u.user_id
            LEFT JOIN user a ON b.approver_id = a.user_id
            WHERE b.booking_status IN ('reserved', 'rejected')
            ORDER BY b.booking_datetime DESC
        `;

        con.query(sql, (err, rows) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: 'Database query error' });
            }

            const data = rows.map(item => ({
                bookingId: item.booking_id,
                status: item.booking_status, // 'reserved' or 'rejected'
                rejectReason: item.reject_reason,
                date: item.bookingDate,
                roomName: item.room_name,
                roomType: item.room_type,
                time: `${item.startTime}-${item.endTime}`,
                requesterName: item.requesterName || 'Unknown',
                approverName: item.approverName || 'N/A',
                imageUrl: `/api/rooms/${item.room_id}/image`
            }));

            res.json(data);
        });
    });
});

module.exports = router;
