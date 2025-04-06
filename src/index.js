import express from "express";
import http from "http";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import { Server } from "socket.io";
import authRoutes from "./routes/authRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import executeRoute from "./routes/executeRoute.js";
// import { getFileExtension } from "./utils.js";
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';


dotenv.config();
connectDB();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Utility function to generate unique filename
function generateUniqueFilename(language) {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(7);
  return `code_${timestamp}_${randomString}.${getFileExtension(language)}`;
}


// Execute code for different languages
async function executeCode(language, code) {
  const tempDir = path.join(__dirname, 'temp');
  await fs.mkdir(tempDir, { recursive: true });

  const filename = generateUniqueFilename(language);
  const filepath = path.join(tempDir, filename);

  try {
    // Write code to file
    await fs.writeFile(filepath, code);

    // Execution commands for different languages
    const commands = {
      'python': `python ${filepath}`,
      'java': `javac ${filepath} && java -cp ${tempDir} ${path.basename(filepath, '.java')}`,
      'cpp': `g++ ${filepath} -o ${filepath}.out && ${filepath}.out`,
      'golang': `go run ${filepath}`,
      'javascript': `node ${filepath}`
    };

    const command = commands[language.toLowerCase()];
    
    if (!command) {
      throw new Error(`Unsupported language: ${language}`);
    }

    return new Promise((resolve, reject) => {
      exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else if (stderr) {
          reject(new Error(stderr));
        } else {
          resolve(stdout);
        }
      });
    });
  } catch (error) {
    console.error('Execution error:', error);
    throw error;
  } finally {
    // Clean up temporary files
    await fs.unlink(filepath).catch(() => {});
    if (language === 'java' || language === 'cpp') {
      await fs.unlink(`${filepath}.out`).catch(() => {});
    }
  }
}

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/session", sessionRoutes);
app.use("/api/session/execute", executeRoute);

// Create HTTP server
const server = http.createServer(app);

 

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// WebSocket server
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"], // Add polling as fallback
});

// Single connection handler
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  
  // Store user info with socket
  let userId = null;
  let currentSessionId = null;
  const sessionParticipants = {};
  
  socket.on("joinSession", (sessionId) => {
    console.log(`Client ${socket.id} joining session: ${sessionId}`);
    socket.join(sessionId);
    currentSessionId = sessionId;
    
    // Initialize session participants array if needed
    if (!sessionParticipants[sessionId]) {
      sessionParticipants[sessionId] = [];
    }
    
    // Get number of clients in room
    const clients = io.sockets.adapter.rooms.get(sessionId);
    console.log(`Clients in session ${sessionId}: ${clients ? clients.size : 0}`);
  });
  
  socket.on("userJoined", ({ userId: id, name, isHost }) => {
    userId = id;
    
    if (currentSessionId) {
      const newParticipant = {
        id,
        name,
        isHost,
        isMuted: false,
        isVideoOff: false
      };
      
      // Add to participants list
      sessionParticipants[currentSessionId].push(newParticipant);
      
      // Notify all clients in the session
      io.to(currentSessionId).emit("participantJoined", newParticipant);
      io.to(currentSessionId).emit("participantsList", sessionParticipants[currentSessionId]);
    }
  });
  
  socket.on("getParticipants", (sessionId) => {
    if (sessionParticipants[sessionId]) {
      socket.emit("participantsList", sessionParticipants[sessionId]);
    } else {
      socket.emit("participantsList", []);
    }
  });
  
  socket.on("codeUpdate", ({ sessionId, code }) => {
    console.log(`Client ${socket.id} sent code update for session ${sessionId}`);
    // Make sure you're broadcasting the code content, not the whole object
    socket.to(sessionId).emit("codeUpdate", code);
  });
  
  // WebRTC signaling
  socket.on("rtcReady", ({ sessionId, userId }) => {
    console.log(`Client ${socket.id} is ready for WebRTC in session ${sessionId}`);
    
    // Notify all other clients in the session that a new participant is ready
    socket.to(sessionId).emit("rtcNewParticipant", { participantId: userId });
  });
  
  socket.on("rtcOffer", ({ sessionId, senderId, receiverId, sdp }) => {
    console.log(`Client ${senderId} sent offer to ${receiverId}`);
    
    // Forward the offer to the intended recipient
    socket.to(sessionId).emit("rtcOffer", { senderId, sdp });
  });
  socket.on("rtcAnswer", ({ sessionId, senderId, receiverId, sdp }) => {
    console.log(`Client ${senderId} sent answer to ${receiverId}`);
    
    // Forward the answer to the intended recipient
    socket.to(sessionId).emit("rtcAnswer", { senderId, sdp });
  });
  
  socket.on("rtcIceCandidate", ({ sessionId, senderId, receiverId, candidate }) => {
    console.log(`Client ${senderId} sent ICE candidate to ${receiverId}`);
    
    // Forward the ICE candidate to the intended recipient
    socket.to(sessionId).emit("rtcIceCandidate", { senderId, candidate });
  });
  
  // Handle audio/video toggling notifications
  socket.on("audioToggled", ({ sessionId, userId, isMuted }) => {
    console.log(`User ${userId} ${isMuted ? 'muted' : 'unmuted'} their audio`);
    
    // Update participant status
    if (sessionParticipants[sessionId]) {
      const participant = sessionParticipants[sessionId].find(p => p.id === userId);
      if (participant) {
        participant.isMuted = isMuted;
      }
    }
    
    // Broadcast to all participants in the session
    socket.to(sessionId).emit("audioToggled", { userId, isMuted });
    
    // Update participants list
    io.to(sessionId).emit("participantsList", sessionParticipants[sessionId]);
  });
  
  socket.on("videoToggled", ({ sessionId, userId, isVideoOff }) => {
    console.log(`User ${userId} ${isVideoOff ? 'turned off' : 'turned on'} their video`);
    
    // Update participant status
    if (sessionParticipants[sessionId]) {
      const participant = sessionParticipants[sessionId].find(p => p.id === userId);
      if (participant) {
        participant.isVideoOff = isVideoOff;
      }
    }
    
    // Broadcast to all participants in the session
    socket.to(sessionId).emit("videoToggled", { userId, isVideoOff });
    
    // Update participants list
    io.to(sessionId).emit("participantsList", sessionParticipants[sessionId]);
  });
  
  socket.on("screenSharingStarted", ({ sessionId, userId }) => {
    console.log(`User ${userId} started screen sharing`);
    
    // Broadcast to all participants in the session
    socket.to(sessionId).emit("screenSharingStarted", { userId });
  });
  
  socket.on("screenSharingEnded", ({ sessionId, userId }) => {
    console.log(`User ${userId} ended screen sharing`);
    
    // Broadcast to all participants in the session
    socket.to(sessionId).emit("screenSharingEnded", { userId });
  });


  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    if (userId && currentSessionId && sessionParticipants[currentSessionId]) {
      // Remove from participants list
      sessionParticipants[currentSessionId] = sessionParticipants[currentSessionId]
        .filter(p => p.id !== userId);
      
      // Notify remaining participants
      io.to(currentSessionId).emit("participantLeft", userId);
      io.to(currentSessionId).emit("participantsList", sessionParticipants[currentSessionId]);
      
      // Clean up empty sessions
      if (sessionParticipants[currentSessionId].length === 0) {
        delete sessionParticipants[currentSessionId];
      }
    }
  });
  
});