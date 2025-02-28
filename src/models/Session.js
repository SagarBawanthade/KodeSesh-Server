import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true },
  code: String,
  language: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});

export default mongoose.model("Session", sessionSchema);
