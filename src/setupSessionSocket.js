import { Server } from 'socket.io';
import Session from '../models/Session.js';

const setupSessionSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL,
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    // Join session room
    socket.on('join-session', async (sessionId, userId) => {
      try {
        const session = await Session.findOne({ session_id: sessionId });
        if (session) {
          socket.join(sessionId);
          io.to(sessionId).emit('user-joined', { userId, timestamp: new Date() });
        }
      } catch (error) {
        console.error('Socket join session error:', error);
      }
    });

    // Leave session room
    socket.on('leave-session', async (sessionId, userId) => {
      socket.leave(sessionId);
      io.to(sessionId).emit('user-left', { userId, timestamp: new Date() });
    });

    // Send real-time updates
    socket.on('session-update', (sessionId, updateData) => {
      io.to(sessionId).emit('session-update', updateData);
    });
  });
};

export default setupSessionSocket;