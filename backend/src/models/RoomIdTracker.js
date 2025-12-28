/**
 * RoomIdTracker Model
 * Tracks all generated room IDs to ensure uniqueness and prevent reuse
 * Room IDs are NEVER deleted - this ensures global uniqueness forever
 */

import mongoose from "mongoose";

const RoomIdTrackerSchema = new mongoose.Schema({
  // The unique room ID (abc-1234-xyz format)
  roomId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    match: /^[a-z]{3}-\d{4}-[a-z]{3}$/,
    immutable: true
  },

  // When this ID was generated
  generatedAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },

  // Associated meeting ID (if any)
  meetingId: {
    type: String,
    sparse: true // Allow null but ensure uniqueness when set
  },

  // Application that requested this ID
  appId: {
    type: String,
    required: true,
    index: true
  }

}, {
  timestamps: false, // We use generatedAt instead
  collection: "room_id_tracker"
});

// Index for fast lookups
RoomIdTrackerSchema.index({ roomId: 1 }, { unique: true });

// Static method to check if a room ID exists
RoomIdTrackerSchema.statics.exists = async function(roomId) {
  const doc = await this.findOne({ roomId }).lean();
  return !!doc;
};

// Static method to reserve a room ID
RoomIdTrackerSchema.statics.reserve = async function(roomId, appId, meetingId = null) {
  try {
    const doc = await this.create({
      roomId,
      appId,
      meetingId
    });
    return { success: true, doc };
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key error - ID already exists
      return { success: false, reason: "ID already exists" };
    }
    throw error;
  }
};

export default mongoose.model("RoomIdTracker", RoomIdTrackerSchema);

