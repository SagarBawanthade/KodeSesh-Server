import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();



passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: "/api/auth/github/callback",
        scope: ["user:email"], 
      },
      async (accessToken, refreshToken, profile, done) => {
        console.log("GitHub Strategy Initialized:");
        console.log("clientID:", process.env.GITHUB_CLIENT_ID);
        console.log("clientSecret:", process.env.GITHUB_CLIENT_SECRET);
  
        try {
          let user = await User.findOne({ email: profile.emails[0].value });
  
          if (!user) {
            user = await User.create({
              name: profile.displayName || profile.username,
              email: profile.emails[0].value,
              password: null,
              githubId: profile.id,
            });
          }
  
          const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "30d" });
  
          return done(null, { user, token });
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );
  

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

export default passport;
