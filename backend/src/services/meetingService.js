/**
 * Meeting Service
 * Business logic layer for meeting operations
 * Follows clean architecture - Controller → Service → Repository
 */

import { config } from "../config.js";
import { meetingRepository, participantRepository } from "../repositories/index.js";
import { generateUniqueRoomId, isValidRoomId } from "../utils/roomIdGenerator.js";
import { generateTurnCredentials } from "../utils/crypto.js";
import { logger } from "../utils/logger.js";

class MeetingService {
  /**
   * Create a new meeting (instant or scheduled)
   */
  async createMeeting(params) {
    const {
      appId,
      createdBy,
      title,
      scheduledAt,
      durationMinutes = config.meeting.defaultDurationMinutes,
      settings = {},
      metadata = {},
      integrations = {}
    } = params;

    try {
      // Generate unique room ID
      const meetingId = await generateUniqueRoomId(appId);

      // Build meeting URL
      const meetingUrl = `${config.meeting.baseUrl}/${meetingId}`;

      // Calculate expiry
      let expiresAt = null;
      if (scheduledAt) {
        expiresAt = new Date(scheduledAt);
        expiresAt.setMinutes(
          expiresAt.getMinutes() + durationMinutes + config.meeting.expiryBufferMinutes
        );
      }

      // Determine initial status
      const status = scheduledAt ? "scheduled" : "created";

      // Create meeting
      const meeting = await meetingRepository.create({
        meetingId,
        appId,
        createdBy,
        title: title || "Video Meeting",
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        durationMinutes,
        expiresAt,
        meetingUrl,
        settings: {
          allowAnonymous: settings.allowAnonymous ?? false,
          waitingRoomEnabled: settings.waitingRoomEnabled ?? false,
          recordingEnabled: settings.recordingEnabled ?? false,
          maxParticipants: settings.maxParticipants ?? 2
        },
        metadata,
        integrations
      });

      logger.info(`Meeting created: ${meetingId} by ${createdBy} (app: ${appId})`);

      return {
        meetingId: meeting.meetingId,
        title: meeting.title,
        status: meeting.status,
        meetingUrl: meeting.meetingUrl,
        scheduledAt: meeting.scheduledAt,
        durationMinutes: meeting.durationMinutes,
        expiresAt: meeting.expiresAt,
        settings: meeting.settings,
        createdAt: meeting.createdAt
      };

    } catch (error) {
      logger.error("MeetingService.createMeeting error:", error.message);
      throw error;
    }
  }

  /**
   * Get meeting details by ID
   */
  async getMeeting(meetingId) {
    try {
      const meeting = await meetingRepository.findByMeetingId(meetingId);
      
      if (!meeting) {
        return null;
      }

      return {
        meetingId: meeting.meetingId,
        title: meeting.title,
        status: meeting.status,
        meetingUrl: meeting.meetingUrl,
        scheduledAt: meeting.scheduledAt,
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        durationMinutes: meeting.durationMinutes,
        expiresAt: meeting.expiresAt,
        settings: meeting.settings,
        appId: meeting.appId,
        createdBy: meeting.createdBy,
        createdAt: meeting.createdAt
      };

    } catch (error) {
      logger.error("MeetingService.getMeeting error:", error.message);
      throw error;
    }
  }

  /**
   * Check if user can join a meeting
   */
  async canJoinMeeting(meetingId, userId = null) {
    try {
      const meeting = await meetingRepository.findByMeetingId(meetingId);
      
      if (!meeting) {
        return { allowed: false, reason: "Meeting not found" };
      }

      // Check status
      const validStatuses = ["created", "scheduled", "active"];
      if (!validStatuses.includes(meeting.status)) {
        return { allowed: false, reason: `Meeting is ${meeting.status}` };
      }

      // Check expiry
      if (meeting.expiresAt && new Date() > new Date(meeting.expiresAt)) {
        // Auto-expire the meeting
        await meetingRepository.updateStatus(meetingId, "expired");
        return { allowed: false, reason: "Meeting has expired" };
      }

      // Check participant limit (exclude current user if they're rejoining)
      // Also skip limit check if maxParticipants is not set or is 0
      const maxParticipants = meeting.settings?.maxParticipants || 100;
      
      if (maxParticipants > 0 && maxParticipants < 100) {
        const activeParticipants = await participantRepository.getActiveInMeeting(meetingId);
        const otherParticipants = userId 
          ? activeParticipants.filter(p => p.userId !== userId)
          : activeParticipants;
        
        logger.info(`canJoinMeeting: meetingId=${meetingId}, userId=${userId}, ` +
          `activeParticipants=${activeParticipants.length}, ` +
          `otherParticipants=${otherParticipants.length}, ` +
          `maxParticipants=${maxParticipants}`);
        
        if (otherParticipants.length >= maxParticipants) {
          logger.warn(`Meeting ${meetingId} is full: ${otherParticipants.length} >= ${maxParticipants}`);
          return { allowed: false, reason: "Meeting is full" };
        }
      } else {
        logger.info(`canJoinMeeting: meetingId=${meetingId}, userId=${userId} - participant limit check skipped`);
      }

      return { 
        allowed: true, 
        meeting: {
          meetingId: meeting.meetingId,
          title: meeting.title,
          status: meeting.status,
          settings: meeting.settings
        }
      };

    } catch (error) {
      logger.error("MeetingService.canJoinMeeting error:", error.message);
      throw error;
    }
  }

  /**
   * Join a meeting
   * Returns the information needed to connect to the meeting
   */
  async joinMeeting(meetingId, participant) {
    const { userId, name = "Guest", role = "participant" } = participant;

    try {
      // Check if can join
      const canJoin = await this.canJoinMeeting(meetingId, userId);
      if (!canJoin.allowed) {
        return { success: false, ...canJoin };
      }

      const meeting = await meetingRepository.findByMeetingId(meetingId);

      // Update meeting status to active if first join
      if (meeting.status === "created" || meeting.status === "scheduled") {
        await meetingRepository.updateStatus(meetingId, "active");
      }

      // Add/update participant
      let existingParticipant = await participantRepository.findByMeetingAndUser(meetingId, userId);
      
      if (existingParticipant) {
        // Rejoin - update status
        await participantRepository.updateStatus(meetingId, userId, "joined");
      } else {
        // New participant
        await participantRepository.add({
          meetingId,
          appId: meeting.appId,
          userId,
          name,
          role,
          status: "joined"
        });
      }

      // Generate TURN credentials
      const turnCreds = generateTurnCredentials(meeting.appId);

      // Build signaling URL
      const signalingUrl = config.meeting.baseUrl.replace(/\/meet$/, "");

      logger.info(`User ${userId} joined meeting ${meetingId}`);

      return {
        success: true,
        meetingId,
        title: meeting.title,
        signalingUrl,
        iceServers: turnCreds.urls.map(url => ({
          urls: [url],
          username: turnCreds.username,
          credential: turnCreds.credential
        })),
        ttl: turnCreds.ttl,
        participant: {
          userId,
          name,
          role
        }
      };

    } catch (error) {
      logger.error("MeetingService.joinMeeting error:", error.message);
      throw error;
    }
  }

  /**
   * Leave a meeting
   */
  async leaveMeeting(meetingId, userId) {
    try {
      await participantRepository.updateStatus(meetingId, userId, "left", {
        leftAt: new Date()
      });

      // Check if meeting should end (no active participants)
      const activeCount = await participantRepository.countInMeeting(meetingId, true);
      
      if (activeCount === 0) {
        // Auto-complete meeting when everyone leaves
        await meetingRepository.updateStatus(meetingId, "completed", {
          endedAt: new Date()
        });
        logger.info(`Meeting ${meetingId} completed - all participants left`);
      }

      logger.info(`User ${userId} left meeting ${meetingId}`);
      return { success: true };

    } catch (error) {
      logger.error("MeetingService.leaveMeeting error:", error.message);
      throw error;
    }
  }

  /**
   * End a meeting
   */
  async endMeeting(meetingId, endedBy) {
    try {
      // Mark all participants as left
      await participantRepository.markAllLeft(meetingId);

      // Update meeting status
      await meetingRepository.updateStatus(meetingId, "completed", {
        endedAt: new Date()
      });

      logger.info(`Meeting ${meetingId} ended by ${endedBy}`);
      return { success: true };

    } catch (error) {
      logger.error("MeetingService.endMeeting error:", error.message);
      throw error;
    }
  }

  /**
   * Get meeting status and participants
   */
  async getMeetingStatus(meetingId) {
    try {
      const meeting = await meetingRepository.findByMeetingId(meetingId);
      
      if (!meeting) {
        return null;
      }

      const participants = await participantRepository.getActiveInMeeting(meetingId);

      return {
        meetingId: meeting.meetingId,
        title: meeting.title,
        status: meeting.status,
        startedAt: meeting.startedAt,
        participants: participants.map(p => ({
          userId: p.userId,
          name: p.name,
          role: p.role,
          status: p.status,
          joinedAt: p.joinedAt,
          mediaState: p.mediaState
        })),
        participantCount: participants.length
      };

    } catch (error) {
      logger.error("MeetingService.getMeetingStatus error:", error.message);
      throw error;
    }
  }

  /**
   * List meetings for an app
   */
  async listMeetings(appId, options = {}) {
    try {
      const meetings = await meetingRepository.findByAppId(appId, options);
      
      return meetings.map(m => ({
        meetingId: m.meetingId,
        title: m.title,
        status: m.status,
        meetingUrl: m.meetingUrl,
        scheduledAt: m.scheduledAt,
        createdAt: m.createdAt,
        createdBy: m.createdBy
      }));

    } catch (error) {
      logger.error("MeetingService.listMeetings error:", error.message);
      throw error;
    }
  }

  /**
   * Update meeting settings
   */
  async updateMeeting(meetingId, updates) {
    try {
      const allowedUpdates = ["title", "scheduledAt", "durationMinutes", "settings", "metadata"];
      const filteredUpdates = {};
      
      for (const key of allowedUpdates) {
        if (updates[key] !== undefined) {
          filteredUpdates[key] = updates[key];
        }
      }

      const meeting = await meetingRepository.update(meetingId, filteredUpdates);
      
      if (!meeting) {
        return null;
      }

      return {
        meetingId: meeting.meetingId,
        title: meeting.title,
        status: meeting.status,
        scheduledAt: meeting.scheduledAt,
        settings: meeting.settings,
        updatedAt: meeting.updatedAt
      };

    } catch (error) {
      logger.error("MeetingService.updateMeeting error:", error.message);
      throw error;
    }
  }

  /**
   * Cancel a meeting
   */
  async cancelMeeting(meetingId, cancelledBy) {
    try {
      // Mark all participants as left
      await participantRepository.markAllLeft(meetingId);

      // Update meeting status
      await meetingRepository.updateStatus(meetingId, "cancelled");

      logger.info(`Meeting ${meetingId} cancelled by ${cancelledBy}`);
      return { success: true };

    } catch (error) {
      logger.error("MeetingService.cancelMeeting error:", error.message);
      throw error;
    }
  }

  /**
   * Validate meeting ID format
   */
  isValidMeetingId(meetingId) {
    return isValidRoomId(meetingId);
  }
}

export default new MeetingService();

