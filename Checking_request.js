const express = require("express");
const con = require("./db");

const router = express.Router();

router.get("/bookings/today/pending", (req, res) => {
  const query = `
    SELECT 
      b.booking_id, 
      b.room_id, 
      b.slot_id, 
      b.booking_status,
      r.room_name, 
      r.room_type, 
      t.start_time, 
      t.end_time
    FROM booking b
    JOIN room r ON b.room_id = r.room_id
    JOIN time_slot t ON b.slot_id = t.slot_id
    WHERE DATE(b.booking_datetime) = CURDATE()
  `;

  con.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching bookings:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.json({ hasBooking: false, bookings: [] });
    }

    return res.json({ hasBooking: true, bookings: results });
  });
});

module.exports = router;
