import express from "express";
import { register, login, githubAuth, githubAuthCallback, getUserDetails, updateUserDetails } from "../controllers/authController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);


// Route to get user details by ID
router.get("/user/:id", getUserDetails);

// Route to update user details by ID
router.put("/user/:id", updateUserDetails);



export default router;
