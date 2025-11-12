const express = require('express');
const argon2 = require('@node-rs/argon2');
const con = require('./db');
const jwt = require('jsonwebtoken'); // 1. IMPORT JWT

// 2. DEFINE YOUR SECRET KEY
// (In a real app, put this in a .env file, not in the code)
const JWT_SECRET = 'your-super-secure-and-long-random-string-12345';

const app = express();
app.use(express.json());


// 3. CREATE THE VERIFY TOKEN MIDDLEWARE
function verifyToken(req, res, next) {
  // Get the token from the header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"

  if (token == null) {
    return res.status(401).json({ message: 'Error: No token provided.' });
  }

  // Check if the token is valid
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log(err);
      return res.status(403).json({ message: 'Error: Invalid or expired token.' });
    }
    // If valid, save the user's info to the request object
    req.user = user; // This now contains { userId, role, username }
    next(); // Move to the next function (the actual route handler)
  });
}


// --- UNPROTECTED ROUTES ---
// (Login and Register do not need a token)

app.get('/api/password/:raw', (req, res) => {
   const raw = req.params.raw;
   const hash = argon2.hashSync(raw);
   res.send(hash);
});


app.post('/api/register', async (req, res) => {
  const { email, username, password, role } = req.body;

  if (!email || !username || !password) {
    return res.status(400).send("Missing required fields");
  }
  
  const emailRegex = /^[a-zA-Z0-9.a-zA-Z0-9.!#$%&'*+-/=?^_`{|}~]+@[a-zA-Z0-9]+\.[a-zA-Z]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).send("Invalid email format");
  }

  try {
    const checkSql = "SELECT user_id FROM user WHERE email = ?";
    con.query(checkSql, [email], async (err, rows) => {
      if (err) return res.status(500).send("Database server error");
      if (rows.length > 0) {
        return res.status(409).send("Email already registered");
      }
      const hashedPassword = await argon2.hash(password);
      const sql = `
        INSERT INTO user (email, username, password, role, createdAt)
        VALUES (?, ?, ?, ?, NOW())
      `;
      con.query(sql, [email, username, hashedPassword, role || "student"], (err, result) => {
        if (err) return res.status(500).send("Database server error");
        res.json({
          message: "User registered successfully",
          userId: result.insertId
        });
      });
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error");
  }
});



app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  const sql = "SELECT user_id, email, password, role, username FROM user WHERE email = ?";
  con.query(sql, [email], (err, result) => {
    if (err) return res.status(500).send("Database server error");
    if (result.length !== 1) return res.status(401).send("Invalid email");

    const user = result[0];
    const passwordMatch = argon2.verifySync(user.password, password);

    if (!passwordMatch) return res.status(401).send("Wrong password");

    // 4. ✅ CREATE THE TOKEN
    const tokenPayload = { 
      userId: user.user_id, 
      role: user.role, 
      username: user.username 
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    // 5. ✅ SEND THE TOKEN AND USER INFO
    res.json({
      uid: user.user_id,
      email: user.email,
      username: user.username,
      role: user.role,
      token: token  // <-- Send token to Flutter
    });
  });
});


// --- PROTECTED ROUTES ---
// (All routes below this line will use the 'verifyToken' middleware)

// GET /api/rooms
app.get('/api/rooms', verifyToken, (req, res) => {
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
// Note: We also protect the image route.
app.get('/api/rooms/:roomId/image', verifyToken, (req, res) => {
  const roomId = req.params.roomId;
  const sql = "SELECT image FROM room WHERE room_id = ?";

  con.query(sql, [roomId], (err, rows) => {
    if (err) return res.status(500).send("Database server error");
    if (rows.length !== 1 || !rows[0].image) return res.status(404).send("Image not found");

    res.setHeader("Content-Type", "image/jpeg");
    res.send(rows[0].image);
  });
});


// GET /api/rooms/:roomId/slots
app.get('/api/rooms/:roomId/slots', verifyToken, (req, res) => {
  const roomId = req.params.roomId;
  const targetDate = req.query.date; 

  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).send("Database server error");

    const sqlRoom = "SELECT room_status FROM room WHERE room_id = ?";
    con.query(sqlRoom, [roomId], (err, roomRows) => {
      if (err) return res.status(500).send("Database server error");
      if (roomRows.length !== 1) return res.status(404).send("Room not found");
      const roomStatus = String(roomRows[0].room_status || '').toLowerCase();
      
      let dateFilterSql;
      let expiryCheckSql;
      let queryParams;

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
        SELECT
          ts.slot_id,
          DATE_FORMAT(ts.start_time, '%H:%i') AS startTime,
          DATE_FORMAT(ts.end_time,   '%H:%i') AS endTime,
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

      con.query(sql, queryParams, (qErr, rows) => {
        if (qErr) {
          console.error(qErr);
          return res.status(500).send("Database server error");
        }
        const data = rows.map(r => {
          const status = String(r.computed_status || 'available').toLowerCase();
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
app.post('/api/rooms/:roomId/slots/:slotId/book', verifyToken, (req, res) => {
  const roomId = req.params.roomId;
  const slotId = req.params.slotId;
  // ✅ Get userId from the token, not the body!
  const userId = req.user.userId;

  if (!userId) {
    return res.status(400).json({ code: 'BAD_REQUEST', message: 'User ID not found in token.' });
  }

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


// GET /api/user/pending-booking (Renamed from /api/user/:userId/pending-booking)
app.get('/api/user/pending-booking', verifyToken, (req, res) => {
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


// GET /api/user/history (Renamed from /api/user/:userId/history)
app.get('/api/user/history', verifyToken, (req, res) => {
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
        approverName: item.approverName || 'N/A'
      }));
      res.json(data);
    });
  });
});



////---------------Lecturer-------------/////

// GET /api/dashboard/stats
app.get('/api/dashboard/stats', verifyToken, (req, res) => {
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


// GET /api/bookings/pending
app.get('/api/bookings/pending', verifyToken, (req, res) => {
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
app.post('/api/bookings/:bookingId/approve', verifyToken, (req, res) => {
  const { bookingId } = req.params;
  // ✅ Get approverId from the token
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
app.post('/api/bookings/:bookingId/reject', verifyToken, (req, res) => {
  const { bookingId } = req.params;
  const { reason } = req.body;
  // ✅ Get approverId from the token
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


// GET /api/lecturer/history (Renamed from /api/lecturer/:userId/history)
app.get('/api/lecturer/history', verifyToken, (req, res) => {
  // ✅ Get lecturer's ID from token
  const { userId } = req.user;

  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).json({ message: 'Database server error' });

    const sql = `
      SELECT
        b.booking_id,
        b.booking_status,
        b.reject_reason,
        DATE_FORMAT(b.booking_datetime, '%b %d, %Y') AS bookingDate,
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
        console.error(err);
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
        approverName: item.approverName || 'N/A'
      }));
      res.json(data);
    });
  });
});


//=================== Starting server =======================
const port = 3000;
app.listen(port, () => {
    console.log('Server is running at ' + port);
});