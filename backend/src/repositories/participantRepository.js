/**
 * Participant Repository
 * Data access layer for participant operations
 */

import { Participant } from "../models/index.js";
import { logger } from "../utils/logger.js";

class ParticipantRepository {
  /**
   * Add a participant to a meeting
   */
  async add(participantData) {
    try {
      const participant = new Participant(participantData);
      await participant.save();
      return participant;
    } catch (error) {
      logger.error("ParticipantRepository.add error:", error.message);
      throw error;
    }
  }

  /**
   * Find participant by meeting and user
   */
  async findByMeetingAndUser(meetingId, userId) {
    try {
      return await Participant.findOne({ meetingId, userId }).lean();
    } catch (error) {
      logger.error("ParticipantRepository.findByMeetingAndUser error:", error.message);
      throw error;
    }
  }

  /**
   * Get active participants in a meeting
   */
  async getActiveInMeeting(meetingId) {
    try {
      return await Participant.getActiveInMeeting(meetingId).lean();
    } catch (error) {
      logger.error("ParticipantRepository.getActiveInMeeting error:", error.message);
      throw error;
    }
  }

  /**
   * Get all participants in a meeting (history)
   */
  async getMeetingHistory(meetingId) {
    try {
      return await Participant.getMeetingHistory(meetingId).lean();
    } catch (error) {
      logger.error("ParticipantRepository.getMeetingHistory error:", error.message);
      throw error;
    }
  }

  /**
   * Update participant status
   */
  async updateStatus(meetingId, userId, status, additionalFields = {}) {
    try {
      const update = { status, ...additionalFields };
      
      if (status === "connected" && !additionalFields.connectedAt) {
        update.connectedAt = new Date();
      }
      if (status === "left" && !additionalFields.leftAt) {
        update.leftAt = new Date();
      }

      return await Participant.findOneAndUpdate(
        { meetingId, userId },
        { $set: update },
        { new: true }
      ).lean();
    } catch (error) {
      logger.error("ParticipantRepository.updateStatus error:", error.message);
      throw error;
    }
  }

  /**
   * Update participant media state
   */
  async updateMediaState(meetingId, userId, mediaState) {
    try {
      return await Participant.findOneAndUpdate(
        { meetingId, userId },
        { $set: { mediaState } },
        { new: true }
      ).lean();
    } catch (error) {
      logger.error("ParticipantRepository.updateMediaState error:", error.message);
      throw error;
    }
  }

  /**
   * Count participants in a meeting
   */
  async countInMeeting(meetingId, activeOnly = true) {
    try {
      const query = { meetingId };
      if (activeOnly) {
        query.status = { $in: ["joined", "connected"] };
      }
      return await Participant.countDocuments(query);
    } catch (error) {
      logger.error("ParticipantRepository.countInMeeting error:", error.message);
      throw error;
    }
  }

  /**
   * Mark all participants as left when meeting ends
   */
  async markAllLeft(meetingId) {
    try {
      const now = new Date();
      const result = await Participant.updateMany(
        { meetingId, status: { $in: ["joined", "connected"] } },
        { $set: { status: "left", leftAt: now } }
      );
      return result.modifiedCount;
    } catch (error) {
      logger.error("ParticipantRepository.markAllLeft error:", error.message);
      throw error;
    }
  }

  /**
   * Get participant statistics for a meeting
   */
  async getMeetingStats(meetingId) {
    try {
      const participants = await Participant.find({ meetingId }).lean();
      
      return {
        total: participants.length,
        active: participants.filter(p => ["joined", "connected"].includes(p.status)).length,
        avgDuration: participants.length > 0
          ? participants.reduce((sum, p) => sum + (p.durationSeconds || 0), 0) / participants.length
          : 0,
        participants: participants.map(p => ({
          userId: p.userId,
          name: p.name,
          role: p.role,
          status: p.status,
          joinedAt: p.joinedAt,
          leftAt: p.leftAt,
          durationSeconds: p.durationSeconds
        }))
      };
    } catch (error) {
      logger.error("ParticipantRepository.getMeetingStats error:", error.message);
      throw error;
    }
  }
}

export default new ParticipantRepository();

