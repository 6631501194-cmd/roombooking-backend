const express = require('express');
const argon2 = require('@node-rs/argon2');
const con = require('./db');


const app = express();
app.use(express.json());



// -------------------- DISABLE ROOM --------------------
// Staff: Disable room (only when room is ENABLE)
app.put("/disable-room/:room_id", (req, res) => {
    const room_id = req.params.room_id;

   
    const checkSql = `
        SELECT room_status 
        FROM room 
        WHERE room_id = ?
    `;

    db.query(checkSql, [room_id], (err, result) => {
        if (err) return res.status(500).json({ error: err });

        if (result.length === 0)
            return res.status(404).json({ message: "Room not found" });

        const status = result[0].room_status;


        if (status !== "enable") {
            return res.status(400).json({
                message: "Room cannot be disabled. Only rooms with 'enable' status can be disabled."
            });
        }

        
        const disableSql = `
            UPDATE room 
            SET room_status = 'disable'
            WHERE room_id = ?
        `;

        db.query(disableSql, [room_id], (err2, result2) => {
            if (err2) return res.status(500).json({ error: err2 });

            return res.json({
                message: "Room disabled successfully",
                room_id: room_id
            });
        });
    });
});


//=================== Starting server =======================
const port = 3000;
app.listen(port, () => {
    console.log('Server is running at ' + port);
});
