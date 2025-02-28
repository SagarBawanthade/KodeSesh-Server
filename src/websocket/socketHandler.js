import { io } from "socket.io-client";

const socket = io("ws://localhost:5000");

socket.on("connect", () => {
  console.log("Connected to server:", socket.id);
  
  // Join a test session
  socket.emit("joinSession", "test123");

  // Send code update
  socket.emit("codeChange", { sessionId: "test123", code: "console.log('Hello, world!');" });

  // Listen for updates
  socket.on("codeUpdate", (updatedCode) => {
    console.log("Received Code Update:", updatedCode);
  });

  // Disconnect after 5 seconds
  // setTimeout(() => {
  //   socket.disconnect();
  //   console.log("Disconnected from server.");
  // }, 5000);
});
