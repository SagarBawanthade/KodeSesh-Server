import { Server } from "socket.io";

const initializeSocket = (server) => {
  const io = new Server(server, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("joinSession", (sessionId) => {
      socket.join(sessionId);
      console.log(`User joined session: ${sessionId}`);
    });

    socket.on("codeChange", ({ sessionId, code }) => {
      socket.to(sessionId).emit("codeUpdate", code);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });

    // AUDIO VIDEO CALL
    socket.on("callUser", (data) => {
      io.to(data.userToCall).emit("incomingCall", {
        from: socket.id,
        signal: data.signal,
      });
    });

    socket.on("answerCall", (data) => {
      io.to(data.to).emit("callAccepted", data.signal);
    });

    socket.on("endCall", (data) => {
      io.to(data.to).emit("callEnded");
    });
  });

  return io;
};

export default initializeSocket;
