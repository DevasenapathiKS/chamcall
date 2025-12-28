/**
 * Participant Model
 * Tracks participants in meetings for audit and analytics
 */

import mongoose from "mongoose";

const ParticipantSchema = new mongoose.Schema({
  // Reference to the meeting
  meetingId: {
    type: String,
    required: true,
    index: true
  },

  // Application/tenant
  appId: {
    type: String,
    required: true,
    index: true
  },

  // User identifier
  userId: {
    type: String,
    required: true
  },

  // Display name
  name: {
    type: String,
    default: "Guest"
  },

  // Participant role
  role: {
    type: String,
    enum: ["host", "participant", "observer"],
    default: "participant"
  },

  // Connection status
  status: {
    type: String,
    enum: ["joined", "connected", "disconnected", "left"],
    default: "joined"
  },

  // Timestamps
  joinedAt: {
    type: Date,
    default: Date.now
  },

  connectedAt: {
    type: Date
  },

  leftAt: {
    type: Date
  },

  // Duration in seconds (calculated when left)
  durationSeconds: {
    type: Number,
    default: 0
  },

  // Media state tracking
  mediaState: {
    audioEnabled: { type: Boolean, default: true },
    videoEnabled: { type: Boolean, default: true },
    screenSharing: { type: Boolean, default: false }
  },

  // Connection quality metrics (for analytics)
  metrics: {
    connectionQuality: String, // "excellent", "good", "fair", "poor"
    networkType: String,
    browser: String,
    device: String
  },

  // Client info
  clientInfo: {
    userAgent: String,
    ip: String,
    region: String
  }

}, {
  timestamps: true,
  collection: "participants"
});

// Compound indexes
ParticipantSchema.index({ meetingId: 1, userId: 1 });
ParticipantSchema.index({ meetingId: 1, status: 1 });
ParticipantSchema.index({ appId: 1, joinedAt: -1 });

// Pre-save hook to calculate duration
ParticipantSchema.pre("save", function(next) {
  if (this.leftAt && this.joinedAt) {
    this.durationSeconds = Math.floor((this.leftAt - this.joinedAt) / 1000);
  }
  next();
});

// Static method to get active participants in a meeting
ParticipantSchema.statics.getActiveInMeeting = function(meetingId) {
  return this.find({
    meetingId,
    status: { $in: ["joined", "connected"] }
  });
};

// Static method to get participant history for a meeting
ParticipantSchema.statics.getMeetingHistory = function(meetingId) {
  return this.find({ meetingId }).sort({ joinedAt: 1 });
};

export default mongoose.model("Participant", ParticipantSchema);

