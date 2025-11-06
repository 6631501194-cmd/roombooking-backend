//app.js
const express = require('express');
const argon2 = require('@node-rs/argon2');
const con = require('./db');
const cors = require('cors');
const authRoutes = require('./routes/auth'); //import routes

const app = express();
app.use(cors());
app.use(express.json());

//ใช้ route สำหรับ auth
app.use('/api/auth', authRoutes);

//=================== Starting server =======================
const port = 3000;
app.listen(port, () => {
    console.log('🚀 Server is running at http://localhost:' + port);
});
