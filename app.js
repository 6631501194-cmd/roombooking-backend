const express = require('express');
const argon2 = require('@node-rs/argon2');
const con = require('./db');


const app = express();
app.use(express.json());

app.get('/api/password/:raw', (req, res) => {
   const raw = req.params.raw;
   const hash = argon2.hashSync(raw);
    // console.log(hash.length);
    // 97 characters
   res.send(hash);
});


app.post('/api/register', async (req, res) => {
  const { email, username, password, role } = req.body;

  // 1) Validate required fields
  if (!email || !username || !password) {
    return res.status(400).send("Missing required fields");
  }
  
  // ✅ FIXED: ADDED EMAIL VALIDATION CHECK
  const emailRegex = /^[a-zA-Z0-9.a-zA-Z0-9.!#$%&'*+-/=?^_`{|}~]+@[a-zA-Z0-9]+\.[a-zA-Z]+$/;
  if (!emailRegex.test(email)) {
    // Send a 400 Bad Request error if the email format is invalid
    return res.status(400).send("Invalid email format");
  }
  // ✅ END OF FIX

  try {
    // 2) Check if email already exists
    const checkSql = "SELECT user_id FROM user WHERE email = ?";
    con.query(checkSql, [email], async (err, rows) => {
      if (err) return res.status(500).send("Database server error");

      if (rows.length > 0) {
        return res.status(409).send("Email already registered");
      }

      // 3) Hash password
      const hashedPassword = await argon2.hash(password);

      // 4) Insert new user
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

    res.json({
      uid: user.user_id,
      email: user.email,
      username: user.username,
      role: user.role
    });
  });
});


// GET /api/rooms
// GET /api/rooms
app.get('/api/rooms', (req, res) => {
  const sql = `
    SELECT room_id, room_name, room_type, room_status
    FROM room
    ORDER BY room_id ASC
  `;
  con.query(sql, (err, rows) => {
    if (err) return res.status(500).send("Database server error");

    // add an image URL your Flutter can hit
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

app.get('/api/rooms/:roomId/image', (req, res) => {
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
// Ensure the app/session timezone is Bangkok once at startup:
// con.query("SET time_zone = '+07:00'");

// GET: list slots for a room with live availability and "expired" rule
app.get('/api/rooms/:roomId/slots', (req, res) => {
  const roomId = req.params.roomId;

  // Ensure MySQL session time zone is correct for NOW()/CURDATE()
  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).send("Database server error");

    // 1) Confirm room & status
    const sqlRoom = "SELECT room_status FROM room WHERE room_id = ?";
    con.query(sqlRoom, [roomId], (err, roomRows) => {
      if (err) return res.status(500).send("Database server error");
      if (roomRows.length !== 1) return res.status(404).send("Room not found");

      const roomStatus = String(roomRows[0].room_status || '').toLowerCase();
      const isDisabled = roomStatus === 'disable';

      // 2) Compute status per time slot for TODAY
      const sql = `
        SELECT
          ts.slot_id,
          DATE_FORMAT(ts.start_time, '%H:%i') AS startTime,
          DATE_FORMAT(ts.end_time,   '%H:%i') AS endTime,
          CASE
            WHEN ? = 'disable' THEN 'disabled'
            WHEN TIME(NOW()) >= ts.end_time THEN 'expired'
            WHEN b.booking_status IS NOT NULL THEN b.booking_status
            ELSE 'available'
          END AS computed_status
        FROM time_slot ts
        LEFT JOIN booking b
          ON b.room_id = ?
         AND b.slot_id = ts.slot_id
         AND DATE(b.booking_datetime) = CURDATE()
         AND b.booking_status IN ('pending','reserved')
        ORDER BY ts.start_time ASC
      `;

      con.query(sql, [roomStatus, roomId], (qErr, rows) => {
        if (qErr) return res.status(500).send("Database server error");

        const data = rows.map(r => {
          const status = String(r.computed_status || 'available').toLowerCase();
          return {
            slotId: r.slot_id,
            time: `${r.startTime}-${r.endTime}`,
            status,                          // disabled | expired | pending | reserved | available
            canBook: status === 'available'  // only available can be booked
          };
        });

        res.json(data);
      });
    });
  });
});





// POST /api/rooms/:roomId/slots/:slotId/book
app.post('/api/rooms/:roomId/slots/:slotId/book', (req, res) => {
  const roomId = req.params.roomId;
  const slotId = req.params.slotId;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ code: 'BAD_REQUEST', message: 'userId is required' });
  }

  // Make sure NOW()/CURDATE() align with Asia/Bangkok
  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).json({ code: 'DB_ERROR', message: 'Database server error' });

    // 1) Room must exist & be enabled
    const sqlRoom = "SELECT room_status FROM room WHERE room_id = ?";
    con.query(sqlRoom, [roomId], (e1, r1) => {
      if (e1) return res.status(500).json({ code: 'DB_ERROR', message: 'Database server error' });
      if (r1.length !== 1) return res.status(404).json({ code: 'ROOM_NOT_FOUND', message: 'Room not found' });
      if (String(r1[0].room_status || '').toLowerCase() === "disable") {
        return res.status(409).json({ code: 'ROOM_DISABLED', message: 'This room is under maintenance.' });
      }

      // 2) Does the user already have an ACTIVE booking today? (pending/reserved)
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

        // 3A) NEW: Block booking if the slot is already expired today
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

          // If current time is later or equal to end_time => expired
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

            // 3B) Slot must be free (no pending/reserved for this room+slot today)
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

              // 4) Create pending booking for TODAY
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


// GET /api/user/:userId/pending-booking
// Gets the user's active pending booking for today
// GET /api/user/:userId/pending-booking
// Gets the user's active pending booking for today
app.get('/api/user/:userId/pending-booking', (req, res) => {
  const { userId } = req.params;

  // Make sure to use Bangkok time
  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).json({ message: 'Database server error' });

    // This query JOINS the tables to get all the info you need
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
        // No pending booking found for today, this is not an error
        return res.json(null);
      }

      // Found a pending booking, format it and send it back
      const booking = rows[0];
      const data = {
        bookingId: booking.booking_id,
        roomName: booking.room_name,
        roomType: booking.room_type,
        time: `${booking.startTime}-${booking.endTime}`,
        status: booking.booking_status,
        // Construct the image URL just like you do in /api/rooms
        imageUrl: `/api/rooms/${booking.room_id}/image`
      };
      res.json(data);
    });
  });
});


// GET /api/user/:userId/history
// Gets a user's entire booking history (approved and rejected)
app.get('/api/user/:userId/history', (req, res) => {
  const { userId } = req.params;

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

      // Format the data to be simple for Flutter
      const data = rows.map(item => ({
        bookingId: item.booking_id,
        status: item.booking_status, // 'reserved' or 'rejected'
        rejectReason: item.reject_reason,
        date: item.bookingDate,
        roomName: item.room_name,
        roomType: item.room_type,
        time: `${item.startTime}-${item.endTime}`,
        approverName: item.approverName || 'N/A' // Handle if approver is null
      }));

      res.json(data);
    });
  });
});



////---------------Lecturer-------------/////

// GET /api/dashboard/stats
// Gets the counts for the lecturer/staff dashboard
app.get('/api/dashboard/stats', (req, res) => {
  // Set timezone to ensure CURDATE() is correct
  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).json({ message: 'Database server error' });

    // This single query gets all 4 counts at once
    const sql = `
      SELECT
        (SELECT COUNT(*) FROM room WHERE room_status = 'enable') AS availableCount,
        (SELECT COUNT(*) FROM room WHERE room_status = 'disable') AS disabledCount,
        (SELECT COUNT(*) FROM booking WHERE booking_status = 'pending' AND DATE(booking_datetime) = CURDATE()) AS pendingCount,
        (SELECT COUNT(*) FROM booking WHERE booking_status = 'reserved' AND DATE(booking_datetime) = CURDATE()) AS reservedCount;
    `;

    con.query(sql, (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database query error' });
      }
      
      // rows will be an array with one object: [{ availableCount: 4, disabledCount: 1, ... }]
      if (rows.length === 0) {
        // This should theoretically never happen, but good to check
        return res.status(500).json({ message: 'Failed to fetch stats' });
      }

      // Send the first (and only) result object
      res.json(rows[0]);
    });
  });
});


// GET /api/bookings/pending
// Gets all pending bookings for today (for lecturer/staff)
app.get('/api/bookings/pending', (req, res) => {
  // Set timezone to ensure CURDATE() is correct
  con.query("SET time_zone = '+07:00'", (tzErr) => {
    if (tzErr) return res.status(500).json({ message: 'Database server error' });

    // This query joins all tables to get info for all pending bookings for today
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

      // Format the data to be simple for Flutter
      const data = rows.map(item => ({
        bookingId: item.booking_id,
        roomName: item.room_name,
        roomType: item.room_type,
        time: `${item.startTime}-${item.endTime}`,
        status: item.booking_status,
        requesterName: item.requesterName,
        imageUrl: `/api/rooms/${item.room_id}/image` // Add the image URL
      }));

      res.json(data);
    });
  });
});


// POST /api/bookings/:bookingId/approve
// Approves a pending booking
app.post('/api/bookings/:bookingId/approve', (req, res) => {
  const { bookingId } = req.params;
  const { approverId } = req.body; // The ID of the lecturer who approved

  if (!approverId) {
    return res.status(400).json({ message: 'Approver ID is required' });
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
// Rejects a pending booking
app.post('/api/bookings/:bookingId/reject', (req, res) => {
  const { bookingId } = req.params;
  const { approverId, reason } = req.body;

  if (!approverId || !reason) {
    return res.status(400).json({ message: 'Approver ID and reason are required' });
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



// GET /api/bookings/history
// Gets all processed bookings (reserved/rejected) for the lecturer history view
// GET /api/lecturer/:userId/history
// Gets the history of bookings *processed* by a specific lecturer
app.get('/api/lecturer/:userId/history', (req, res) => {
  const { userId } = req.params; // This is the lecturer's ID

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
        b.approver_id = ?   -- ✅ This is the new line
        AND b.booking_status IN ('reserved', 'rejected')
      ORDER BY b.booking_datetime DESC;
    `;

    // Pass the lecturer's ID into the query
    con.query(sql, [userId], (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database query error' });
      }

      const data = rows.map(item => ({
        bookingId: item.booking_id,
        status: item.status,
        rejectReason: item.reject_reason,
        date: item.bookingDate,
        roomName: item.room_name,
        roomType: item.room_type,
        time: `${item.startTime}-${item.endTime}`,
        requesterName: item.requesterName,
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
