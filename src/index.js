import express from "express";
import http from "http";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import { Server } from "socket.io";
import authRoutes from "./routes/authRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import executeRoute from "./routes/executeRoute.js";
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

// WebSocket server
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"], // Add polling as fallback
});

// Global session storage
const sessions = {};

// Helper function to find a socket by userID
function findSocketByUserId(sessionId, userId) {
  if (!sessions[sessionId]) return null;
  
  const participant = sessions[sessionId].participants.find(
    p => p.id.toString() === userId.toString()
  );
  
  return participant ? io.sockets.sockets.get(participant.socketId) : null;
}

// Single connection handler
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  
  // Store user info with socket
  let userId = null;
  let currentSessionId = null;
  
  socket.on("joinSession", (sessionId) => {
    console.log(`Client ${socket.id} joining session: ${sessionId}`);
    socket.join(sessionId);
    currentSessionId = sessionId;
    
    // Initialize session if needed
    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        participants: [],
        language: 'javascript',
        code: '// Start writing your code here!'
      };
    }
    
    // Get number of clients in room
    const clients = io.sockets.adapter.rooms.get(sessionId);
    console.log(`Clients in session ${sessionId}: ${clients ? clients.size : 0}`);
  });
  
   // Handle typing indicator events
   socket.on('userTyping', (data) => {
    // Broadcast to everyone else in the session
    socket.to(data.sessionId).emit('userTyping', data);
  });

  
  socket.on("userJoined", ({ userId: id, name, isHost, sessionId }) => {
    userId = id;
    currentSessionId = sessionId;
    
    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        participants: [],
        language: 'javascript',
        code: '// Start writing your code here!'
      };
    }
    
    // Create new participant object
    const newParticipant = {
      id,
      name,
      isHost,
      socketId: socket.id,
      isMuted: false,
      isVideoOff: false,
      isScreenSharing: false
    };
    
    // Remove any existing entries for this user (in case of reconnection)
    sessions[sessionId].participants = sessions[sessionId].participants.filter(
      p => p.id.toString() !== id.toString()
    );
    
    // Add to participants list
    sessions[sessionId].participants.push(newParticipant);
    
    // Store sessionId and userId in socket for cleanup when disconnected
    socket.sessionId = sessionId;
    socket.userId = id;
    
    // Notify all clients in the session
    io.to(sessionId).emit("participantJoined", newParticipant);
    io.to(sessionId).emit("participantsList", sessions[sessionId].participants);
  });
  
  socket.on("getParticipants", (sessionId) => {
    if (sessions[sessionId]) {
      console.log(`Sending participants list for session ${sessionId}: ${sessions[sessionId].participants.length} participants`);
      socket.emit("participantsList", sessions[sessionId].participants);
      
      if (sessions[sessionId].language) {
        socket.emit('languageUpdate', { language: sessions[sessionId].language });
      }
    } else {
      socket.emit("participantsList", []);
    }
  });

  // Handle language update
  socket.on('languageUpdate', ({ sessionId, language }) => {
    console.log(`Language update in session ${sessionId}: ${language}`);
    
    // Update session state
    if (sessions[sessionId]) {
      sessions[sessionId].language = language;
    }
    
    // Broadcast to all clients in the session except sender
    socket.to(sessionId).emit('languageUpdate', { language });
  });
  
  // Handle request for current language state
  socket.on('getLanguageState', (sessionId) => {
    if (sessions[sessionId] && sessions[sessionId].language) {
      socket.emit('languageUpdate', { language: sessions[sessionId].language });
    }
  });


  socket.on('newPR', (data) => {
  // Broadcast to everyone in the session except sender
  socket.to(data.sessionId).emit('newPR', data);
});

socket.on('requestPRs', (data) => {
  // Broadcast the request to everyone in the session
  socket.to(data.sessionId).emit('requestPRs', data);
});

  
  socket.on("codeUpdate", ({ sessionId, code }) => {
    console.log(`Client ${socket.id} sent code update for session ${sessionId}`);
    // Make sure you're broadcasting the code content, not the whole object
    socket.to(sessionId).emit("codeUpdate", code);
    
    // Store latest code in session
    if (sessions[sessionId]) {
      sessions[sessionId].code = code;
    }
  });

  // Listen for code execution results from other users
  socket.on("executionResult", ({ sessionId, output, error, terminalEntries }) => {
    console.log(`Client ${socket.id} shared execution result for session ${sessionId}`);
    
    if (terminalEntries) {
      // New format: forward terminal entries to all other clients
      socket.to(sessionId).emit("executionResult", { terminalEntries });
    } else {
      // Old format: forward output and error separately for backward compatibility
      socket.to(sessionId).emit("executionResult", { output, error });
    }
  });
  
  // ===== IMPROVED WEBRTC SIGNALING =====
  
  // WebRTC signaling - ready for connections
  socket.on("rtcReady", ({ sessionId, userId }) => {
    console.log(`Client ${userId} (${socket.id}) is ready for WebRTC in session ${sessionId}`);
    
    // Notify all other clients in the session that a new participant is ready
    socket.to(sessionId).emit("rtcNewParticipant", { participantId: userId });
  });
  
  // Explicit request for connection
  socket.on("rtcRequestConnection", ({ sessionId, requesterId, targetId }) => {
    console.log(`Client ${requesterId} requesting connection with ${targetId}`);
    
    // Find the socket for the target user
    if (sessions[sessionId]) {
      const targetParticipant = sessions[sessionId].participants.find(
        p => p.id.toString() === targetId.toString()
      );
      
      if (targetParticipant) {
        // Send direct message to the target
        const targetSocket = io.sockets.sockets.get(targetParticipant.socketId);
        if (targetSocket) {
          targetSocket.emit("rtcNewParticipant", { participantId: requesterId });
        } else {
          // If we can't find the socket, broadcast to everyone
          socket.to(sessionId).emit("rtcNewParticipant", { participantId: requesterId });
        }
      } else {
        // Broadcast to everyone in case we can't find the exact participant
        socket.to(sessionId).emit("rtcNewParticipant", { participantId: requesterId });
      }
    }
  });
  
  // WebRTC offer from one peer to another
  socket.on("rtcOffer", ({ sessionId, senderId, receiverId, sdp }) => {
    console.log(`Client ${senderId} sent offer to ${receiverId}`);
    
    // Try to find the target socket
    if (sessions[sessionId]) {
      const targetParticipant = sessions[sessionId].participants.find(
        p => p.id.toString() === receiverId.toString()
      );
      
      if (targetParticipant) {
        // Send directly to the receiver
        const targetSocket = io.sockets.sockets.get(targetParticipant.socketId);
        if (targetSocket) {
          targetSocket.emit("rtcOffer", { senderId, sdp });
          return;
        }
      }
    }
    
    // Fallback: broadcast to session (less efficient but ensures delivery)
    socket.to(sessionId).emit("rtcOffer", { senderId, sdp });
  });
  
  // WebRTC answer from recipient back to offerer
  socket.on("rtcAnswer", ({ sessionId, senderId, receiverId, sdp }) => {
    console.log(`Client ${senderId} sent answer to ${receiverId}`);
    
    // Try to find the target socket
    if (sessions[sessionId]) {
      const targetParticipant = sessions[sessionId].participants.find(
        p => p.id.toString() === receiverId.toString()
      );
      
      if (targetParticipant) {
        // Send directly to the receiver
        const targetSocket = io.sockets.sockets.get(targetParticipant.socketId);
        if (targetSocket) {
          targetSocket.emit("rtcAnswer", { senderId, sdp });
          return;
        }
      }
    }
    
    // Fallback: broadcast to session
    socket.to(sessionId).emit("rtcAnswer", { senderId, sdp });
  });
  
  // WebRTC ICE candidates
  socket.on("rtcIceCandidate", ({ sessionId, senderId, receiverId, candidate }) => {
    console.log(`Client ${senderId} sent ICE candidate to ${receiverId}`);
    
    // Try to find the target socket
    if (sessions[sessionId]) {
      const targetParticipant = sessions[sessionId].participants.find(
        p => p.id.toString() === receiverId.toString()
      );
      
      if (targetParticipant) {
        // Send directly to the receiver
        const targetSocket = io.sockets.sockets.get(targetParticipant.socketId);
        if (targetSocket) {
          targetSocket.emit("rtcIceCandidate", { senderId, candidate });
          return;
        }
      }
    }
    
    // Fallback: broadcast to session
    socket.to(sessionId).emit("rtcIceCandidate", { senderId, candidate });
  });
  
  // Handle audio/video toggling notifications
  socket.on("audioToggled", ({ sessionId, userId, isMuted }) => {
    console.log(`User ${userId} ${isMuted ? 'muted' : 'unmuted'} their audio`);
    
    // Update participant status
    if (sessions[sessionId]) {
      const participant = sessions[sessionId].participants.find(p => p.id.toString() === userId.toString());
      if (participant) {
        participant.isMuted = isMuted;
      }
    }
    
    // Broadcast to all participants in the session
    socket.to(sessionId).emit("audioToggled", { userId, isMuted });
    
    // Update participants list
    io.to(sessionId).emit("participantsList", sessions[sessionId]?.participants || []);
  });
  
  socket.on("videoToggled", ({ sessionId, userId, isVideoOff }) => {
    console.log(`User ${userId} ${isVideoOff ? 'turned off' : 'turned on'} their video`);
    
    // Update participant status
    if (sessions[sessionId]) {
      const participant = sessions[sessionId].participants.find(p => p.id.toString() === userId.toString());
      if (participant) {
        participant.isVideoOff = isVideoOff;
      }
    }
    
    // Broadcast to all participants in the session
    socket.to(sessionId).emit("videoToggled", { userId, isVideoOff });
    
    // Update participants list
    io.to(sessionId).emit("participantsList", sessions[sessionId]?.participants || []);
  });
  
  socket.on("screenSharingStarted", ({ sessionId, userId }) => {
    console.log(`User ${userId} started screen sharing`);
    
    // Update participant status
    if (sessions[sessionId]) {
      const participant = sessions[sessionId].participants.find(p => p.id.toString() === userId.toString());
      if (participant) {
        participant.isScreenSharing = true;
      }
    }
    
    // Broadcast to all participants in the session
    socket.to(sessionId).emit("screenSharingStarted", { userId });
  });
  
  socket.on("screenSharingEnded", ({ sessionId, userId }) => {
    console.log(`User ${userId} ended screen sharing`);
    
    // Update participant status
    if (sessions[sessionId]) {
      const participant = sessions[sessionId].participants.find(p => p.id.toString() === userId.toString());
      if (participant) {
        participant.isScreenSharing = false;
      }
    }
    
    // Broadcast to all participants in the session
    socket.to(sessionId).emit("screenSharingEnded", { userId });
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    // Get sessionId and userId stored in socket data
    const sessionId = socket.sessionId;
    const userId = socket.userId;
    
    if (userId && sessionId && sessions[sessionId]) {
      console.log(`Removing participant ${userId} from session ${sessionId}`);
      
      // Remove from participants list
      sessions[sessionId].participants = sessions[sessionId].participants.filter(
        p => p.id.toString() !== userId.toString()
      );
      
      // Notify remaining participants
      io.to(sessionId).emit("participantLeft", userId);
      io.to(sessionId).emit("participantsList", sessions[sessionId].participants);
      
      // Clean up empty sessions
      if (sessions[sessionId].participants.length === 0) {
        console.log(`Removing empty session ${sessionId}`);
        delete sessions[sessionId];
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));