/**
 * Meeting Model
 * Represents a scheduled or instant meeting/interview session
 */

import mongoose from "mongoose";

const MeetingSchema = new mongoose.Schema({
  // Unique meeting ID in format: abc-1234-xyz
  meetingId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    match: /^[a-z]{3}-\d{4}-[a-z]{3}$/,
    immutable: true // Cannot be changed after creation
  },

  // Meeting title/description
  title: {
    type: String,
    default: "Video Meeting",
    maxlength: 200
  },

  // Application/tenant that created this meeting
  appId: {
    type: String,
    required: true,
    index: true
  },

  // User who created/scheduled the meeting
  createdBy: {
    type: String,
    required: true
  },

  // Meeting lifecycle status
  status: {
    type: String,
    enum: ["created", "scheduled", "active", "completed", "expired", "cancelled"],
    default: "created",
    index: true
  },

  // Scheduling information
  scheduledAt: {
    type: Date,
    index: true
  },
  
  startedAt: {
    type: Date
  },
  
  endedAt: {
    type: Date
  },

  // Meeting duration in minutes (for scheduling)
  durationMinutes: {
    type: Number,
    default: 60,
    min: 5,
    max: 480 // 8 hours max
  },

  // Expiry time (after which the meeting link is invalid)
  expiresAt: {
    type: Date,
    index: true
  },

  // Meeting link for sharing
  meetingUrl: {
    type: String
  },

  // Meeting settings
  settings: {
    allowAnonymous: { type: Boolean, default: false },
    waitingRoomEnabled: { type: Boolean, default: false },
    recordingEnabled: { type: Boolean, default: false },
    maxParticipants: { type: Number, default: 10, min: 2, max: 100 }
  },

  // Custom metadata for integrations
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Integration references (calendar, email, etc.)
  integrations: {
    calendarEventId: String,
    externalId: String,
    source: String // "api", "calendar", "email", etc.
  }

}, {
  timestamps: true, // Adds createdAt and updatedAt
  collection: "meetings"
});

// Compound indexes for common queries
MeetingSchema.index({ appId: 1, status: 1 });
MeetingSchema.index({ appId: 1, scheduledAt: 1 });
MeetingSchema.index({ createdBy: 1, status: 1 });

// Virtual for checking if meeting is joinable
MeetingSchema.virtual("isJoinable").get(function() {
  const now = new Date();
  const validStatuses = ["created", "scheduled", "active"];
  
  if (!validStatuses.includes(this.status)) return false;
  if (this.expiresAt && now > this.expiresAt) return false;
  
  return true;
});

// Pre-save hook to set expiry and meeting URL
MeetingSchema.pre("save", function(next) {
  // Set expiry if scheduled
  if (this.scheduledAt && !this.expiresAt) {
    const expiryTime = new Date(this.scheduledAt);
    expiryTime.setMinutes(expiryTime.getMinutes() + this.durationMinutes + 30); // 30 min buffer
    this.expiresAt = expiryTime;
  }
  
  next();
});

// Instance method to check if user can join
MeetingSchema.methods.canJoin = function(userId) {
  if (!this.isJoinable) return { allowed: false, reason: "Meeting not available" };
  if (this.status === "completed") return { allowed: false, reason: "Meeting ended" };
  if (this.status === "expired") return { allowed: false, reason: "Meeting expired" };
  if (this.status === "cancelled") return { allowed: false, reason: "Meeting cancelled" };
  
  return { allowed: true };
};

// Static method to find active meetings
MeetingSchema.statics.findActive = function(appId) {
  return this.find({
    appId,
    status: { $in: ["created", "scheduled", "active"] },
    $or: [
      { expiresAt: { $gt: new Date() } },
      { expiresAt: null }
    ]
  }).sort({ scheduledAt: 1 });
};

// Export model
export default mongoose.model("Meeting", MeetingSchema);

