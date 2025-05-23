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
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import natsService from "./services/natsService.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();
connectDB();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper function to get file extension
function getFileExtension(language) {
  const extensions = {
    'python': 'py',
    'java': 'java',
    'cpp': 'cpp',
    'golang': 'go',
    'javascript': 'js'
  };
  return extensions[language.toLowerCase()] || 'txt';
}

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
  transports: ["websocket", "polling"],
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

// Initialize NATS connection
async function initializeNATS() {
  const natsUrl = process.env.NATS_URL || 'nats://localhost:4222';
  const connected = await natsService.connect(natsUrl);
  
  if (connected) {
    console.log('✅ NATS initialized successfully');
    
    // Subscribe to global PR sync requests
    const sub = natsService.nc.subscribe('pr.sync.request');
    
    (async () => {
      for await (const msg of sub) {
        try {
          const data = natsService.jc.decode(msg.data);
          console.log('📨 Received global PR sync request via NATS:', data);
          
          // Handle sync request by broadcasting to appropriate session
          io.to(data.sessionId).emit('requestPRSync', data);
        } catch (error) {
          console.error('Error processing NATS message:', error);
        }
      }
    })();
  } else {
    console.warn('⚠️ NATS connection failed. PR sync across instances will not work.');
  }
}

// Socket.IO connection handler
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  
  // Store user info with socket
  let userId = null;
  let currentSessionId = null;
  
  // Handle session joining
  socket.on("joinSession", async (sessionId) => {
    console.log(`Client ${socket.id} joining session: ${sessionId}`);
    socket.join(sessionId);
    currentSessionId = sessionId;
    
    // Initialize session if needed
    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        participants: [],
        language: 'javascript',
        code: '// Start writing your code here!',
        natsSubscribed: false
      };
    }
    
    // Subscribe to NATS PR events for this session
    if (!sessions[sessionId].natsSubscribed) {
      await natsService.subscribeToPREvents(sessionId, (data) => {
        console.log(`📥 Received PR event via NATS for session ${sessionId}:`, data.eventType);
        
        // Broadcast NATS PR events to all clients in the session
        io.to(sessionId).emit('prSync', {
          sessionId: data.sessionId,
          eventType: data.eventType,
          prData: data.prData
        });
      });
      
      sessions[sessionId].natsSubscribed = true;
    }
    
    // Get number of clients in room
    const clients = io.sockets.adapter.rooms.get(sessionId);
    console.log(`Clients in session ${sessionId}: ${clients ? clients.size : 0}`);
  });
  
  // Handle typing indicator events
  socket.on('userTyping', (data) => {
    socket.to(data.sessionId).emit('userTyping', data);
  });
  
  // Handle user joining
  socket.on("userJoined", ({ userId: id, name, isHost, sessionId }) => {
    userId = id;
    currentSessionId = sessionId;
    
    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        participants: [],
        language: 'javascript',
        code: '// Start writing your code here!',
        natsSubscribed: false
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
  
  // Get participants list
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
  
  // Enhanced PR sync with NATS
  socket.on('prSync', async (data) => {
    console.log(`📤 PR sync event from ${socket.id}:`, data.eventType);
    
    // Broadcast locally via Socket.io
    socket.to(data.sessionId).emit('prSync', data);
    
    // Publish to NATS for cross-instance sync
    await natsService.publishPREvent(
      data.sessionId, 
      data.eventType, 
      data.prData
    );
  });
  
  // Handle PR sync requests
  socket.on('requestPRSync', async (data) => {
    console.log(`📨 PR sync request for session ${data.sessionId}`);
    
    // Request via NATS for cross-instance sync
    await natsService.requestPRSync(data.sessionId, data.userId);
    
    // Also handle locally
    socket.to(data.sessionId).emit('requestPRSync', data);
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
  
  // Handle session ending
  socket.on("sessionEnding", (data) => {
    console.log(`Session ${data.sessionId} is ending`);
    socket.to(data.sessionId).emit("sessionEnding", data);
  });
  
  // Handle terminal updates
  socket.on("terminalUpdate", (data) => {
    socket.to(data.sessionId).emit("terminalUpdate", data);
  });
  
  // Handle terminal history requests
  socket.on("getTerminalHistory", (sessionId) => {
    // In a production app, you'd store and retrieve terminal history
    socket.emit("terminalHistory", { sessionId, history: [] });
  });
  
  // Handle code updates
  socket.on("codeUpdate", ({ sessionId, code }) => {
    console.log(`Client ${socket.id} sent code update for session ${sessionId}`);
    
    // Broadcast the code content to other users
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
  
  // ===== WebRTC Signaling =====
  
  // WebRTC signaling - ready for connections
  socket.on("rtcReady", ({ sessionId, userId }) => {
    console.log(`Client ${userId} (${socket.id}) is ready for WebRTC in session ${sessionId}`);
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
  
  // WebRTC offer
  socket.on("rtcOffer", ({ sessionId, senderId, receiverId, sdp }) => {
    console.log(`Client ${senderId} sent offer to ${receiverId}`);
    
    const targetSocket = findSocketByUserId(sessionId, receiverId);
    if (targetSocket) {
      targetSocket.emit("rtcOffer", { senderId, sdp });
    } else {
      socket.to(sessionId).emit("rtcOffer", { senderId, sdp });
    }
  });
  
  // WebRTC answer
  socket.on("rtcAnswer", ({ sessionId, senderId, receiverId, sdp }) => {
    console.log(`Client ${senderId} sent answer to ${receiverId}`);
    
    const targetSocket = findSocketByUserId(sessionId, receiverId);
    if (targetSocket) {
      targetSocket.emit("rtcAnswer", { senderId, sdp });
    } else {
      socket.to(sessionId).emit("rtcAnswer", { senderId, sdp });
    }
  });
  
  // WebRTC ICE candidates
  socket.on("rtcIceCandidate", ({ sessionId, senderId, receiverId, candidate }) => {
    console.log(`Client ${senderId} sent ICE candidate to ${receiverId}`);
    
    const targetSocket = findSocketByUserId(sessionId, receiverId);
    if (targetSocket) {
      targetSocket.emit("rtcIceCandidate", { senderId, candidate });
    } else {
      socket.to(sessionId).emit("rtcIceCandidate", { senderId, candidate });
    }
  });
  
  // Handle audio/video toggling
  socket.on("audioToggled", ({ sessionId, userId, isMuted }) => {
    console.log(`User ${userId} ${isMuted ? 'muted' : 'unmuted'} their audio`);
    
    if (sessions[sessionId]) {
      const participant = sessions[sessionId].participants.find(
        p => p.id.toString() === userId.toString()
      );
      if (participant) {
        participant.isMuted = isMuted;
      }
    }
    
    socket.to(sessionId).emit("audioToggled", { userId, isMuted });
    io.to(sessionId).emit("participantsList", sessions[sessionId]?.participants || []);
  });
  
  socket.on("videoToggled", ({ sessionId, userId, isVideoOff }) => {
    console.log(`User ${userId} ${isVideoOff ? 'turned off' : 'turned on'} their video`);
    
    if (sessions[sessionId]) {
      const participant = sessions[sessionId].participants.find(
        p => p.id.toString() === userId.toString()
      );
      if (participant) {
        participant.isVideoOff = isVideoOff;
      }
    }
    
    socket.to(sessionId).emit("videoToggled", { userId, isVideoOff });
    io.to(sessionId).emit("participantsList", sessions[sessionId]?.participants || []);
  });
  
  // Screen sharing events
  socket.on("screenSharingStarted", ({ sessionId, userId }) => {
    console.log(`User ${userId} started screen sharing`);
    
    if (sessions[sessionId]) {
      const participant = sessions[sessionId].participants.find(
        p => p.id.toString() === userId.toString()
      );
      if (participant) {
        participant.isScreenSharing = true;
      }
    }
    
    socket.to(sessionId).emit("screenSharingStarted", { userId });
  });
  
  socket.on("screenSharingEnded", ({ sessionId, userId }) => {
    console.log(`User ${userId} ended screen sharing`);
    
    if (sessions[sessionId]) {
      const participant = sessions[sessionId].participants.find(
        p => p.id.toString() === userId.toString()
      );
      if (participant) {
        participant.isScreenSharing = false;
      }
    }
    
    socket.to(sessionId).emit("screenSharingEnded", { userId });
  });
  
  // Handle disconnection
  socket.on("disconnect", async () => {
    console.log(`Client disconnected: ${socket.id}`);
    
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
        
        // Unsubscribe from NATS events for this session
        if (sessions[sessionId].natsSubscribed) {
          await natsService.unsubscribeFromPREvents(sessionId);
        }
        
        delete sessions[sessionId];
      }
    }
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  
  // Initialize NATS after server starts
  await initializeNATS();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  
  // Close NATS connection
  await natsService.close();
  
  // Close server
  server.close(() => {
    console.log('✅ Server shut down gracefully');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export default app;