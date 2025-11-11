const express = require("express");
const con = require("./db");
const router = express.Router();

router.put("/booking/reject/:id", (req, res) => {
  const bookingId = req.params.id;
  const { approver_id, reason } = req.body;

  if (!approver_id || !reason) {
    return res.status(400).json({ message: "approver_id and reason are required" });
  }

  const query = `
    UPDATE booking
    SET booking_status = 'rejected',
        approver_id = ?,
        reject_reason = ?
    WHERE booking_id = ?
  `;

  con.query(query, [approver_id, reason, bookingId], (err, result) => {
    if (err) {
      console.error("Error rejecting booking:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    return res.json({ message: "Booking rejected successfully" });
  });
});

module.exports = router;
