const express = require('express');
const app = express();

app.use(express.json());

// Import routers
const login = require('./login');
const regis = require('./regis');
const student = require('./student');
const staff = require('./staff');
const lecturer = require('./lecturer');

// Register routers
app.use(login);
app.use(regis);
app.use(student);
app.use(staff);
app.use(lecturer);

// Server
const port = 3000;
app.listen(port, () => console.log(`Server running at ${port}`));
