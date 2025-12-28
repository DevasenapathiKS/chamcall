/**
 * Meeting Repository
 * Data access layer for meeting operations
 * Follows repository pattern for clean separation of concerns
 */

import { Meeting, RoomIdTracker } from "../models/index.js";
import { logger } from "../utils/logger.js";

class MeetingRepository {
  /**
   * Create a new meeting
   */
  async create(meetingData) {
    try {
      const meeting = new Meeting(meetingData);
      await meeting.save();
      return meeting;
    } catch (error) {
      logger.error("MeetingRepository.create error:", error.message);
      throw error;
    }
  }

  /**
   * Find meeting by meetingId
   */
  async findByMeetingId(meetingId) {
    try {
      return await Meeting.findOne({ meetingId }).lean();
    } catch (error) {
      logger.error("MeetingRepository.findByMeetingId error:", error.message);
      throw error;
    }
  }

  /**
   * Find meeting by meetingId (returns Mongoose document for updates)
   */
  async findByMeetingIdForUpdate(meetingId) {
    try {
      return await Meeting.findOne({ meetingId });
    } catch (error) {
      logger.error("MeetingRepository.findByMeetingIdForUpdate error:", error.message);
      throw error;
    }
  }

  /**
   * Find meetings by appId
   */
  async findByAppId(appId, options = {}) {
    try {
      const { status, limit = 50, skip = 0 } = options;
      const query = { appId };
      
      if (status) {
        query.status = Array.isArray(status) ? { $in: status } : status;
      }

      return await Meeting.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    } catch (error) {
      logger.error("MeetingRepository.findByAppId error:", error.message);
      throw error;
    }
  }

  /**
   * Find active/joinable meetings
   */
  async findActive(appId) {
    try {
      return await Meeting.findActive(appId).lean();
    } catch (error) {
      logger.error("MeetingRepository.findActive error:", error.message);
      throw error;
    }
  }

  /**
   * Update meeting status
   */
  async updateStatus(meetingId, status, additionalFields = {}) {
    try {
      const update = { status, ...additionalFields };
      
      // Set timestamps based on status
      if (status === "active" && !additionalFields.startedAt) {
        update.startedAt = new Date();
      }
      if (status === "completed" && !additionalFields.endedAt) {
        update.endedAt = new Date();
      }

      return await Meeting.findOneAndUpdate(
        { meetingId },
        { $set: update },
        { new: true }
      ).lean();
    } catch (error) {
      logger.error("MeetingRepository.updateStatus error:", error.message);
      throw error;
    }
  }

  /**
   * Update meeting
   */
  async update(meetingId, updateData) {
    try {
      return await Meeting.findOneAndUpdate(
        { meetingId },
        { $set: updateData },
        { new: true }
      ).lean();
    } catch (error) {
      logger.error("MeetingRepository.update error:", error.message);
      throw error;
    }
  }

  /**
   * Check if meeting ID exists
   */
  async meetingIdExists(meetingId) {
    try {
      const count = await Meeting.countDocuments({ meetingId });
      return count > 0;
    } catch (error) {
      logger.error("MeetingRepository.meetingIdExists error:", error.message);
      throw error;
    }
  }

  /**
   * Reserve a room ID (ensures uniqueness)
   */
  async reserveRoomId(roomId, appId, meetingId = null) {
    try {
      return await RoomIdTracker.reserve(roomId, appId, meetingId);
    } catch (error) {
      logger.error("MeetingRepository.reserveRoomId error:", error.message);
      throw error;
    }
  }

  /**
   * Check if room ID is already used
   */
  async roomIdExists(roomId) {
    try {
      return await RoomIdTracker.exists(roomId);
    } catch (error) {
      logger.error("MeetingRepository.roomIdExists error:", error.message);
      throw error;
    }
  }

  /**
   * Get meetings scheduled between dates
   */
  async findScheduledBetween(appId, startDate, endDate) {
    try {
      return await Meeting.find({
        appId,
        scheduledAt: {
          $gte: startDate,
          $lte: endDate
        }
      }).sort({ scheduledAt: 1 }).lean();
    } catch (error) {
      logger.error("MeetingRepository.findScheduledBetween error:", error.message);
      throw error;
    }
  }

  /**
   * Expire old meetings
   */
  async expireOldMeetings() {
    try {
      const now = new Date();
      const result = await Meeting.updateMany(
        {
          status: { $in: ["created", "scheduled"] },
          expiresAt: { $lt: now }
        },
        { $set: { status: "expired" } }
      );
      return result.modifiedCount;
    } catch (error) {
      logger.error("MeetingRepository.expireOldMeetings error:", error.message);
      throw error;
    }
  }

  /**
   * Count meetings by status
   */
  async countByStatus(appId) {
    try {
      const result = await Meeting.aggregate([
        { $match: { appId } },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]);
      
      return result.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {});
    } catch (error) {
      logger.error("MeetingRepository.countByStatus error:", error.message);
      throw error;
    }
  }
}

export default new MeetingRepository();

