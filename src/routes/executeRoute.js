import express from "express";
import { codeExecute } from "../controllers/executeController.js";

const router = express.Router();

// Session routes with authentication middleware
router.post('/code-execute', codeExecute);

export default router;