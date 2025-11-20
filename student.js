const express = require('express');
const con = require('./db');
const { verifyToken } = require('./middleware');

const router = express.Router();

// GET /api/rooms
router.get('/api/rooms', verifyToken, (req, res) => {
  const sql = `
    SELECT room_id, room_name, room_type, room_status
    FROM room
    ORDER BY room_id ASC
  `;
  con.query(sql, (err, rows) => {
    if (err) return res.status(500).send("Database server error");
    const data = rows.map(r => ({
      room_id: r.room_id,
      room_name: r.room_name,
      room_type: r.room_type,
      room_status: r.room_status,
      image_url: `/api/rooms/${r.room_id}/image`
    }));
    res.json(data);
  });
});

// GET /api/rooms/:roomId/image
router.get('/api/rooms/:roomId/image', verifyToken, (req, res) => {
  const sql = "SELECT image FROM room WHERE room_id = ?";
  con.query(sql, [req.params.roomId], (err, rows) => {
    if (err) return res.status(500).send("Database server error");
    if (!rows.length || !rows[0].image) return res.status(404).send("Image not found");

    res.setHeader("Content-Type", "image/jpeg");
    res.send(rows[0].image);
  });
});

// GET /api/rooms/:roomId/slots
router.get('/api/rooms/:roomId/slots', verifyToken, (req, res) => {
  const roomId = req.params.roomId;
  const targetDate = req.query.date;

  con.query("SET time_zone = '+07:00'", () => {
    const sqlRoom = "SELECT room_status FROM room WHERE room_id = ?";
    con.query(sqlRoom, [roomId], (err, roomRows) => {
      if (err) return res.status(500).send("Database error");
      if (!roomRows.length) return res.status(404).send("Room not found");

      const roomStatus = String(roomRows[0].room_status).toLowerCase();
      
      let dateFilterSql, expiryCheckSql, queryParams;

      if (targetDate) {
        dateFilterSql = 'DATE(b.booking_datetime) = ?';
        expiryCheckSql = '(? = CURDATE() AND TIME(NOW()) >= ts.end_time)';
        queryParams = [roomStatus, targetDate, roomId, targetDate];
      } else {
        dateFilterSql = 'DATE(b.booking_datetime) = CURDATE()';
        expiryCheckSql = 'TIME(NOW()) >= ts.end_time';
        queryParams = [roomStatus, roomId];
      }

      const sql = `
        SELECT ts.slot_id,
               DATE_FORMAT(ts.start_time,'%H:%i') AS startTime,
               DATE_FORMAT(ts.end_time,'%H:%i') AS endTime,
               CASE
                 WHEN ? = 'disable' THEN 'disabled'
                 WHEN ${expiryCheckSql} THEN 'expired'
                 WHEN b.booking_status IS NOT NULL THEN b.booking_status
                 ELSE 'available'
               END AS computed_status
        FROM time_slot ts
        LEFT JOIN booking b
          ON b.room_id = ?
         AND b.slot_id = ts.slot_id
         AND ${dateFilterSql}
         AND b.booking_status IN ('pending','reserved')
        ORDER BY ts.start_time ASC
      `;

      con.query(sql, queryParams, (err, rows) => {
        if (err) return res.status(500).send("Database error");

        const data = rows.map(r => {
          const status = r.computed_status.toLowerCase();
          return {
            slotId: r.slot_id,
            time: `${r.startTime}-${r.endTime}`,
            status,
            canBook: status === 'available'
          };
        });

        res.json(data);
      });
    });
  });
});

// POST /api/rooms/:roomId/slots/:slotId/book
router.post('/api/rooms/:roomId/slots/:slotId/book', verifyToken, (req, res) => {
  const roomId = req.params.roomId;
  const slotId = req.params.slotId;
  const userId = req.user.userId;

  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).json({ code: 'DB_ERROR', message: 'Database server error' });
    
    const sqlRoom = "SELECT room_status FROM room WHERE room_id = ?";
    con.query(sqlRoom, [roomId], (e1, r1) => {
      if (e1) return res.status(500).json({ code: 'DB_ERROR', message: 'Database server error' });
      if (r1.length !== 1) return res.status(404).json({ code: 'ROOM_NOT_FOUND', message: 'Room not found' });
      if (String(r1[0].room_status || '').toLowerCase() === "disable") {
        return res.status(409).json({ code: 'ROOM_DISABLED', message: 'This room is under maintenance.' });
      }

      const sqlUserActiveToday = `
        SELECT booking_status
        FROM booking
        WHERE user_id = ?
          AND DATE(booking_datetime) = CURDATE()
          AND booking_status IN ('pending','reserved')
        ORDER BY booking_datetime DESC
        LIMIT 1
      `;
      con.query(sqlUserActiveToday, [userId], (eU, rU) => {
        if (eU) return res.status(500).json({ code: 'DB_ERROR', message: 'Database server error' });

        if (rU.length > 0) {
          const st = String(rU[0].booking_status || '').toLowerCase();
          if (st === 'pending') {
            return res.status(409).json({
              code: 'PENDING_TODAY',
              message: 'Your booking is pending. Please wait for approval.'
            });
          }
          if (st === 'reserved') {
            return res.status(409).json({
              code: 'RESERVED_TODAY',
              message: 'You have booked today. Book again tomorrow.'
            });
          }
          return res.status(409).json({
            code: 'ACTIVE_TODAY',
            message: 'You already have a booking today.'
          });
        }

        const sqlSlotTime = `
          SELECT start_time, end_time
          FROM time_slot
          WHERE slot_id = ?
          LIMIT 1
        `;
        con.query(sqlSlotTime, [slotId], (eS, rS) => {
          if (eS) return res.status(500).json({ code: 'DB_ERROR', message: 'Database server error' });
          if (rS.length !== 1) {
            return res.status(404).json({ code: 'SLOT_NOT_FOUND', message: 'Time slot not found' });
          }

          const sqlExpiredCheck = `SELECT TIME(NOW()) >= ? AS isExpired`;
          con.query(sqlExpiredCheck, [rS[0].end_time], (eC, rC) => {
            if (eC) return res.status(500).json({ code: 'DB_ERROR', message: 'Database server error' });

            const isExpired = rC && rC[0] && Number(rC[0].isExpired) === 1;
            if (isExpired) {
              return res.status(409).json({
                code: 'SLOT_EXPIRED',
                message: 'This time slot has already passed.'
              });
            }

            const sqlClash = `
              SELECT 1
              FROM booking
              WHERE room_id = ? AND slot_id = ?
                AND DATE(booking_datetime) = CURDATE()
                AND booking_status IN ('pending','reserved')
              LIMIT 1
            `;
            con.query(sqlClash, [roomId, slotId], (e2, r2) => {
              if (e2) return res.status(500).json({ code: 'DB_ERROR', message: 'Database server error' });
              if (r2.length > 0) {
                return res.status(409).json({ code: 'SLOT_TAKEN', message: 'This time slot is not available.' });
              }

              const sqlInsert = `
                INSERT INTO booking(user_id, room_id, slot_id, booking_datetime, booking_status)
                VALUES (?, ?, ?, NOW(), 'pending')
              `;
              con.query(sqlInsert, [userId, roomId, slotId], (e3, r3) => {
                if (e3) return res.status(500).json({ code: 'DB_ERROR', message: 'Database server error' });
                if (r3.affectedRows !== 1) {
                  return res.status(500).json({ code: 'INSERT_FAILED', message: 'Error creating booking' });
                }
                res.status(201).json({
                  message: 'Booking created',
                  bookingId: r3.insertId,
                  status: 'pending'
                });
              });
            });
          });
        });
      });
    });
  });
});

// GET /api/user/pending-booking
router.get('/api/user/pending-booking', verifyToken, (req, res) => {
     // ✅ Use ID from token
  const { userId } = req.user;

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
        DATE_FORMAT(ts.end_time, '%H:%i') AS endTime
      FROM booking b
      JOIN room r ON b.room_id = r.room_id
      JOIN time_slot ts ON b.slot_id = ts.slot_id
      WHERE
        b.user_id = ?
        AND b.booking_status = 'pending'
        AND DATE(b.booking_datetime) = CURDATE()
      ORDER BY b.booking_id DESC
      LIMIT 1;
    `;
    con.query(sql, [userId], (err, rows) => {
      if (err) return res.status(500).json({ message: 'Database query error' });
      if (rows.length === 0) {
        return res.json(null);
      }
      const booking = rows[0];
      const data = {
        bookingId: booking.booking_id,
        roomName: booking.room_name,
        roomType: booking.room_type,
        time: `${booking.startTime}-${booking.endTime}`,
        status: booking.booking_status,
        imageUrl: `/api/rooms/${booking.room_id}/image`
      };
      res.json(data);
    });
  });
});

// GET /api/user/history
router.get('/api/user/history', verifyToken, (req, res) => {
    // ✅ Use ID from token
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
        a.username AS approverName
      FROM booking b
      JOIN room r ON b.room_id = r.room_id
      JOIN time_slot ts ON b.slot_id = ts.slot_id
      LEFT JOIN user a ON b.approver_id = a.user_id
      WHERE
        b.user_id = ?
        AND b.booking_status IN ('reserved', 'rejected')
      ORDER BY b.booking_datetime DESC;
    `;
    con.query(sql, [userId], (err, rows) => {
      if (err) return res.status(500).json({ message: 'Database query error' });
      const data = rows.map(item => ({
        bookingId: item.booking_id,
        status: item.booking_status,
        rejectReason: item.reject_reason,
        date: item.bookingDate,
        roomName: item.room_name,
        roomType: item.room_type,
        time: `${item.startTime}-${item.endTime}`,
        approverName: item.approverName || 'N/A',
        // add imageUrl so the client can fetch the binary image endpoint
        imageUrl: `/api/rooms/${item.room_id}/image`
      }));
      res.json(data);
    });
  });
});


module.exports = router;
