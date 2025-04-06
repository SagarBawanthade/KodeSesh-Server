import Session from "../models/Session.js";
import { v4 as uuidv4 } from "uuid";

// Middleware to validate session access
export const validateSessionAccess = async (req, res, next) => {
  try {
    const session = await Session.findOne({ session_id: req.params.session_id });
    
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    
    if (session.status !== 'active') {
      return res.status(403).json({ message: "Session is not active" });
    }
    
    req.session = session;
    next();
  } catch (error) {
    res.status(500).json({ error: "Error validating session access" });
  }
};

// Create a session
export const createSession = async (req, res) => {
  try {
    const { title, max_participants } = req.body;

    if (!req.user || !req.user._id) {
      return res.status(401).json({ error: "Authentication failed" });
    }

    const host = {
      user_id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: "host"
    };

    const session_id = uuidv4();
    const session_link = `${process.env.APP_URL}/session/${session_id}`;

    const newSession = new Session({
      session_id,
      title,
      host,
      status: 'active',
      session_link,
      participants: [host],
      max_participants: max_participants || 10,
      expires_at: new Date(+new Date() + 24*60*60*1000) // 24 hours expiry
    });

    await newSession.save();

    return res.status(201).json({ 
      message: "Session created successfully",
      session_id, 
      session_link 
    });
  } catch (error) {
    console.error("Error creating session:", error);
    return res.status(500).json({ error: "Error creating session" });
  }
};

// Join a session
export const joinSession = async (req, res) => {
  try {
    const { session_id } = req.body;
    const formattedSessionId = session_id.toString().trim();

    const session = await Session.findOne({ session_id: formattedSessionId });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Check session status and participant limit
    if (session.status !== 'active') {
      return res.status(403).json({ message: "Session is not active" });
    }

    if (session.participants.length >= session.max_participants) {
      return res.status(400).json({ message: "Session is full" });
    }

    // Check if user is already a participant
    const isParticipant = session.participants.some(
      (participant) => participant.user_id.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      session.participants.push({
        user_id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: "participant",
        joined_at: new Date()
      });

      await session.save();
    }

    return res.json({
      message: "Joined session successfully",
      session_id: session.session_id,
      participants: session.participants.length
    });
  } catch (error) {
    console.error("Error joining session:", error);
    return res.status(500).json({ 
      error: "Error joining session", 
      details: error.message 
    });
  }
};

// Get session details
export const getSession = async (req, res) => {
  try {
    const session = await Session.findOne({ session_id: req.params.session_id })
      .populate("participants.user_id", "name email");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    return res.json({
      session_id: session.session_id,
      title: session.title,
      status: session.status,
      participants: session.participants,
      max_participants: session.max_participants,
      expires_at: session.expires_at
    });
  } catch (error) {
    return res.status(500).json({ error: "Error fetching session details" });
  }
};

// Leave a session
export const leaveSession = async (req, res) => {
  try {
    const { session_id } = req.body;
    const session = await Session.findOne({ session_id });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Find participant index
    const participantIndex = session.participants.findIndex(
      (p) => p.user_id.toString() === req.user._id.toString()
    );

    if (participantIndex === -1) {
      return res.status(400).json({ message: "User is not a participant" });
    }

    // If host leaves, end the session
    if (session.host.user_id.toString() === req.user._id.toString()) {
      session.status = 'ended';
    }

    // Remove user from participants
    session.participants.splice(participantIndex, 1);

    await session.save();

    return res.json({ 
      message: "Left session successfully",
      remaining_participants: session.participants.length
    });
  } catch (error) {
    console.error("Error leaving session:", error);
    return res.status(500).json({ error: "Error leaving session" });
  }
};

// Delete a session (Only host can delete)
export const deleteSession = async (req, res) => {
  try {
    const { session_id } = req.params;
    const session = await Session.findOne({ session_id });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Check if the user is the host
    if (session.host.user_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the host can delete the session" });
    }

    await Session.deleteOne({ session_id });

    return res.json({ message: "Session deleted successfully" });
  } catch (error) {
    console.error("Error deleting session:", error);
    return res.status(500).json({ error: "Error deleting session" });
  }
};