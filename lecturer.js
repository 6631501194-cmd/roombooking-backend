const express = require('express');
const con = require('./db');
const { verifyToken } = require('./middleware');

const router = express.Router();

// GET /api/dashboard/stats
router.get('/api/dashboard/stats', verifyToken, (req, res) => {
  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).json({ message: 'Database server error' });
    const sql = `
      SELECT
        (SELECT COUNT(*) FROM room WHERE room_status = 'enable') AS enabledRooms,
        (SELECT COUNT(*) FROM room WHERE room_status = 'disable') AS disabledRooms,
        (SELECT COUNT(*) FROM time_slot) AS slotsPerRoom,
        (SELECT COUNT(*) FROM booking WHERE booking_status = 'pending' AND DATE(booking_datetime) = CURDATE()) AS pendingCount,
        (SELECT COUNT(*) FROM booking WHERE booking_status = 'reserved' AND DATE(booking_datetime) = CURDATE()) AS reservedCount,
        (SELECT COUNT(*) FROM time_slot WHERE end_time <= TIME(NOW())) AS expiredSlotsCount;
    `;
    con.query(sql, (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database query error' });
      }
      if (rows.length === 0) {
        return res.status(500).json({ message: 'Failed to fetch stats' });
      }
      const stats = rows[0];
      const slotsPerRoom = stats.slotsPerRoom;
      const pendingCount = stats.pendingCount;
      const reservedCount = stats.reservedCount;
      const disabledCount = stats.disabledRooms * slotsPerRoom;
      const totalEnabledSlots = stats.enabledRooms * slotsPerRoom;
      const expiredCountToday = stats.expiredSlotsCount * stats.enabledRooms;
      const availableCount = totalEnabledSlots - pendingCount - reservedCount - expiredCountToday;

      res.json({
        availableCount: (availableCount < 0) ? 0 : availableCount,
        pendingCount: pendingCount,
        reservedCount: reservedCount,
        disabledCount: disabledCount
      });
    });
  });
});

// GET /api/lecturer/bookings/pending
router.get('/api/lecturer/bookings/pending', verifyToken, (req, res) => {
  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).json({ message: 'Database server error' });
    const sql = `
      SELECT
        b.booking_id,
        b.booking_status,
        r.room_id,
        r.room_name,
        r.room_type,
        DATE_FORMAT(ts.start_time, '%H:%i') AS startTime,
        DATE_FORMAT(ts.end_time, '%H:%i') AS endTime,
        u.username AS requesterName
      FROM booking b
      JOIN room r ON b.room_id = r.room_id
      JOIN time_slot ts ON b.slot_id = ts.slot_id
      JOIN user u ON b.user_id = u.user_id
      WHERE
        b.booking_status = 'pending'
        AND DATE(b.booking_datetime) = CURDATE()
      ORDER BY b.booking_datetime ASC;
    `;
    con.query(sql, (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database query error' });
      }
      const data = rows.map(item => ({
        bookingId: item.booking_id,
        roomName: item.room_name,
        roomType: item.room_type,
        time: `${item.startTime}-${item.endTime}`,
        status: item.booking_status,
        requesterName: item.requesterName || 'Unknown User',
        imageUrl: `/api/rooms/${item.room_id}/image`
      }));
      res.json(data);
    });
  });
});

// POST /api/bookings/:bookingId/approve
router.post('/api/bookings/:bookingId/approve', verifyToken, (req, res) => {
  const { bookingId } = req.params;
  const approverId = req.user.userId;

  if (!approverId) {
    return res.status(400).json({ message: 'Approver ID not found in token' });
  }

  const sql = `
    UPDATE booking
    SET booking_status = 'reserved',
        approver_id = ?
    WHERE booking_id = ? AND booking_status = 'pending'
  `;
  con.query(sql, [approverId, bookingId], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Booking not found or already processed' });
    }
    res.status(200).json({ message: 'Booking approved' });
  });
});

// POST /api/bookings/:bookingId/reject
router.post('/api/bookings/:bookingId/reject', verifyToken, (req, res) => {
  const { bookingId } = req.params;
  const { reason } = req.body;
  const approverId = req.user.userId;

  if (!approverId || !reason) {
    return res.status(400).json({ message: 'Approver ID (from token) and reason (from body) are required' });
  }

  const sql = `
    UPDATE booking
    SET booking_status = 'rejected',
        approver_id = ?,
        reject_reason = ?
    WHERE booking_id = ? AND booking_status = 'pending'
  `;
  con.query(sql, [approverId, reason, bookingId], (err, result) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Booking not found or already processed' });
    }
    res.status(200).json({ message: 'Booking rejected' });
  });
});

// GET /api/lecturer/history
router.get('/api/lecturer/history', verifyToken, (req, res) => {
  const { userId } = req.user;

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
        DATE_FORMAT(ts.end_time, '%H:%i') AS endTime,
        u.username AS requesterName,
        a.username AS approverName
      FROM booking b
      JOIN room r ON b.room_id = r.room_id
      JOIN time_slot ts ON b.slot_id = ts.slot_id
      JOIN user u ON b.user_id = u.user_id
      LEFT JOIN user a ON b.approver_id = a.user_id
      WHERE
        b.approver_id = ?
        AND b.booking_status IN ('reserved', 'rejected')
      ORDER BY b.booking_datetime DESC;
    `;
    con.query(sql, [userId], (err, rows) => {
      if (err) {
        console.error('lecturer/history SQL error:', err);
        return res.status(500).json({ message: 'Database query error' });
      }
      const data = rows.map(item => ({
        bookingId: item.booking_id,
        status: item.booking_status,
        rejectReason: item.reject_reason,
        date: item.bookingDate,
        roomName: item.room_name,
        roomType: item.room_type,
        time: `${item.startTime}-${item.endTime}`,
        requesterName: item.requesterName || 'Unknown User',
        approverName: item.approverName || 'N/A',
        imageUrl: `/api/rooms/${item.room_id}/image`
      }));
      res.json(data);
    });
  });
});

module.exports = router;
