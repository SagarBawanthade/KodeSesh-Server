import express from "express";
import { authenticateUser } from "../middleware/auth.js";
import {
  createSession,
  joinSession,
  getSession,
  leaveSession,
  deleteSession,
  validateSessionAccess
} from '../controllers/sessionController.js';
const router = express.Router();

// Session routes with authentication middleware
router.post('/create', authenticateUser, createSession);
router.post('/join', authenticateUser, joinSession);
// router.get('/:session_id', authenticateUser, validateSessionAccess, getSession);
router.get('/:session_id', getSession);
router.post('/leave', authenticateUser, leaveSession);
router.delete('/:session_id', authenticateUser, deleteSession);

export default router;