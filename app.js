const express = require("express");
const cors = require("cors");
const argon2 = require("@node-rs/argon2");
const con = require("./db");
const approveRoutes = require("./approved");
const rejectRoutes = require("./reject");

const app = express();

app.use(cors());
app.use(express.json());

// Lecturer routes
app.use("/api", approveRoutes);
app.use("/api", rejectRoutes);

//=================== Starting server =======================
const port = 3000;
app.listen(port, () => {
  console.log("Server is running at " + port);
});
