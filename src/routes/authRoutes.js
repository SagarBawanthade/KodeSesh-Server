import express from "express";
import { register, login, githubAuth, githubAuthCallback, getUserDetails } from "../controllers/authController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/getuser",getUserDetails);

//Github Auth Routes
router.get("/github", githubAuth);
router.get("/github/callback", githubAuthCallback);

export default router;
