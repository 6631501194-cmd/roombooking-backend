const express = require("express");
const cors = require("cors");
const argon2 = require("@node-rs/argon2");
const con = require("./db");
const bookingRoutes = require("./Checking_request");
const history = require("./history");
const app = express();

app.use(cors());
app.use(express.json());

app.use("/api", history);
app.use("/api", bookingRoutes);

//=================== Starting server =======================
const port = 3000;
app.listen(port, () => {
  console.log("Server is running at port " + port);
});
