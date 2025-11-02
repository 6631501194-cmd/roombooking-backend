const express = require('express');
const argon2 = require('@node-rs/argon2');
const con = require('./db');


const app = express();
app.use(express.json());




//=================== Starting server =======================
const port = 3000;
app.listen(port, () => {
    console.log('Server is running at ' + port);
});
