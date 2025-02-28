import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import passport from "passport";

export const githubAuth = passport.authenticate("github", { scope: ["user:email"] });

export const githubAuthCallback = (req, res, next) => {
  passport.authenticate("github", (err, data) => {
    if (err || !data) {
      return res.redirect("http://localhost:5173/login?error=GitHub authentication failed");
    }
    
    res.redirect(`http://localhost:5173/dashboard?token=${data.token}`);
  })(req, res, next);
};


export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if all fields are provided
    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if the user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists with this email" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user
    const user = await User.create({ name, email, password: hashedPassword });

    // Send response
    res.status(201).json({ 
      token: generateToken(user._id), 
      user, 
      message: "User registered successfully" 
    });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if all fields are provided
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Check if password is correct
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Send response
    res.json({ 
      token: generateToken(user._id), 
      user, 
      message: "Login successful" 
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};


export const setNewPassword = async (req, res) => {
  try {
    const { userId, password } = req.body;
    
    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    await User.findByIdAndUpdate(userId, { password: hashedPassword });

    res.json({ message: "Password set successfully" });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};
