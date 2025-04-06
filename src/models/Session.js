// models/Session.js
import mongoose from 'mongoose';

const SessionSchema = new mongoose.Schema({
  session_id: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  status: { type: String, enum: ['active', 'inactive', 'ended'], default: 'active' },
  host: {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User'
    },
    name: String,
    email: String,
    role: {
      type: String,
      default: 'host'
    }
  },
  participants: [
    {
      user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      name: String,
      email: String,
      role: {
        type: String,
        default: 'participant'
      },
      joined_at: {
        type: Date,
        default: Date.now
      }
    }
  ],
  session_link: {
    type: String,
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});



const Session = mongoose.model('Session', SessionSchema);
export default Session;


