const { io } = require("socket.io-client");

const socket = io("http://localhost:3000");

socket.on("connect", () => {
  console.log("TEST SUCCESS: Connected to server with ID:", socket.id);
  socket.disconnect();
});

socket.on("connect_error", (err) => {
  console.log("TEST FAILED: Connection error:", err.message);
  process.exit(1);
});
