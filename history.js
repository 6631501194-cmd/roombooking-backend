const express = require("express");
const con = require("./db");

const router = express.Router();

router.get("/bookings/all", (req, res) => {
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
  `;
  
  con.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching bookings:", err);
      res.status(500).json({ error: "Database error" });
      return;
    }
    res.json(results);
  });
});

module.exports = router;