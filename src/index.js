import express from "express";
import http from "http";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import initializeSocket from "./socket.js";
import passport from "./config/passport.js";


dotenv.config();
connectDB();


const app = express();
app.use(cors({ origin: "*" }));
app.use(passport.initialize());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use("/api/auth", authRoutes);

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket
initializeSocket(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
