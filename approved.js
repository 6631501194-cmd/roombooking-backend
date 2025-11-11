const express = require("express");
const con = require("./db");
const router = express.Router();

router.put("/booking/approve/:id", (req, res) => {
  const bookingId = req.params.id;
  const { approver_id } = req.body; 

  if (!approver_id) {
    return res.status(400).json({ message: "approver_id is required" });
  }

  const query = `
    UPDATE booking
    SET booking_status = 'reserved',
        approver_id = ?,
        reject_reason = NULL
    WHERE booking_id = ?
  `;

  con.query(query, [approver_id, bookingId], (err, result) => {
    if (err) {
      console.error("Error approving booking:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    return res.json({ message: "Booking approved successfully" });
  });
});

module.exports = router;
