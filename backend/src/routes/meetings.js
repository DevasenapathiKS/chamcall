/**
 * Meeting Routes
 * API endpoints for meeting management
 * 
 * Uses clean architecture: Controller → Service → Repository
 * Authentication is modular and can be disabled for meeting access
 */

import { Router } from "express";
import createError from "http-errors";
import meetingService from "../services/meetingService.js";
import { 
  requireAppAuth, 
  meetingAccess, 
  optionalAuth 
} from "../middleware/authMiddleware.js";
import { logger } from "../utils/logger.js";

const router = Router();

/**
 * POST /api/meetings
 * Create a new meeting
 * 
 * Body:
 * - title (optional): Meeting title
 * - scheduledAt (optional): ISO date for scheduled meetings
 * - durationMinutes (optional): Meeting duration (default: 60)
 * - settings (optional): { allowAnonymous, waitingRoomEnabled, maxParticipants }
 * - metadata (optional): Custom metadata for integrations
 * - integrations (optional): { calendarEventId, externalId, source }
 */
router.post("/", requireAppAuth, async (req, res, next) => {
  try {
    const { appId } = req.appContext;
    const createdBy = req.body.createdBy || req.token?.sub || "api";
    
    const meeting = await meetingService.createMeeting({
      appId,
      createdBy,
      title: req.body.title,
      scheduledAt: req.body.scheduledAt,
      durationMinutes: req.body.durationMinutes,
      settings: req.body.settings,
      metadata: req.body.metadata,
      integrations: req.body.integrations
    });

    res.status(201).json(meeting);
    
  } catch (error) {
    logger.error("POST /api/meetings error:", error.message);
    next(error);
  }
});

/**
 * GET /api/meetings
 * List meetings for the authenticated app
 * 
 * Query params:
 * - status (optional): Filter by status (comma-separated)
 * - limit (optional): Max results (default: 50)
 * - skip (optional): Skip results for pagination
 */
router.get("/", requireAppAuth, async (req, res, next) => {
  try {
    const { appId } = req.appContext;
    const { status, limit = 50, skip = 0 } = req.query;
    
    const statusArray = status ? status.split(",").map(s => s.trim()) : null;
    
    const meetings = await meetingService.listMeetings(appId, {
      status: statusArray,
      limit: parseInt(limit, 10),
      skip: parseInt(skip, 10)
    });

    res.json({ meetings, count: meetings.length });
    
  } catch (error) {
    logger.error("GET /api/meetings error:", error.message);
    next(error);
  }
});

/**
 * GET /api/meetings/:meetingId
 * Get meeting details
 */
router.get("/:meetingId", optionalAuth, async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    
    if (!meetingService.isValidMeetingId(meetingId)) {
      return next(createError(400, "Invalid meeting ID format"));
    }

    const meeting = await meetingService.getMeeting(meetingId);
    
    if (!meeting) {
      return next(createError(404, "Meeting not found"));
    }

    res.json(meeting);
    
  } catch (error) {
    logger.error("GET /api/meetings/:meetingId error:", error.message);
    next(error);
  }
});

/**
 * GET /api/meetings/:meetingId/status
 * Get meeting status with active participants
 */
router.get("/:meetingId/status", optionalAuth, async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    
    if (!meetingService.isValidMeetingId(meetingId)) {
      return next(createError(400, "Invalid meeting ID format"));
    }

    const status = await meetingService.getMeetingStatus(meetingId);
    
    if (!status) {
      return next(createError(404, "Meeting not found"));
    }

    res.json(status);
    
  } catch (error) {
    logger.error("GET /api/meetings/:meetingId/status error:", error.message);
    next(error);
  }
});

/**
 * POST /api/meetings/:meetingId/join
 * Join a meeting
 * 
 * Body:
 * - userId: Unique identifier for the participant
 * - name (optional): Display name
 * - role (optional): "host", "participant", or "observer"
 * 
 * Returns connection info (signaling URL, ICE servers, etc.)
 */
router.post("/:meetingId/join", async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    const { userId, name, role } = req.body;
    
    if (!meetingService.isValidMeetingId(meetingId)) {
      return next(createError(400, "Invalid meeting ID format"));
    }

    if (!userId) {
      return next(createError(400, "userId is required"));
    }

    const result = await meetingService.joinMeeting(meetingId, {
      userId,
      name: name || "Guest",
      role: role || "participant"
    });

    if (!result.success) {
      return next(createError(403, result.reason));
    }

    res.json(result);
    
  } catch (error) {
    logger.error("POST /api/meetings/:meetingId/join error:", error.message);
    next(error);
  }
});

/**
 * POST /api/meetings/:meetingId/leave
 * Leave a meeting
 * 
 * Body:
 * - userId: Identifier of the participant leaving
 */
router.post("/:meetingId/leave", meetingAccess, async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    const { userId } = req.body;
    
    if (!meetingService.isValidMeetingId(meetingId)) {
      return next(createError(400, "Invalid meeting ID format"));
    }

    if (!userId) {
      return next(createError(400, "userId is required"));
    }

    const result = await meetingService.leaveMeeting(meetingId, userId);
    res.json(result);
    
  } catch (error) {
    logger.error("POST /api/meetings/:meetingId/leave error:", error.message);
    next(error);
  }
});

/**
 * PUT /api/meetings/:meetingId
 * Update meeting settings
 * 
 * Body (all optional):
 * - title
 * - scheduledAt
 * - durationMinutes
 * - settings
 * - metadata
 */
router.put("/:meetingId", requireAppAuth, async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    
    if (!meetingService.isValidMeetingId(meetingId)) {
      return next(createError(400, "Invalid meeting ID format"));
    }

    const meeting = await meetingService.updateMeeting(meetingId, req.body);
    
    if (!meeting) {
      return next(createError(404, "Meeting not found"));
    }

    res.json(meeting);
    
  } catch (error) {
    logger.error("PUT /api/meetings/:meetingId error:", error.message);
    next(error);
  }
});

/**
 * POST /api/meetings/:meetingId/end
 * End a meeting (mark as completed)
 * 
 * Body:
 * - endedBy (optional): User who ended the meeting
 */
router.post("/:meetingId/end", requireAppAuth, async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    const endedBy = req.body.endedBy || req.token?.sub || "api";
    
    if (!meetingService.isValidMeetingId(meetingId)) {
      return next(createError(400, "Invalid meeting ID format"));
    }

    const result = await meetingService.endMeeting(meetingId, endedBy);
    res.json(result);
    
  } catch (error) {
    logger.error("POST /api/meetings/:meetingId/end error:", error.message);
    next(error);
  }
});

/**
 * POST /api/meetings/:meetingId/cancel
 * Cancel a scheduled meeting
 */
router.post("/:meetingId/cancel", requireAppAuth, async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    const cancelledBy = req.body.cancelledBy || req.token?.sub || "api";
    
    if (!meetingService.isValidMeetingId(meetingId)) {
      return next(createError(400, "Invalid meeting ID format"));
    }

    const result = await meetingService.cancelMeeting(meetingId, cancelledBy);
    res.json(result);
    
  } catch (error) {
    logger.error("POST /api/meetings/:meetingId/cancel error:", error.message);
    next(error);
  }
});

/**
 * GET /api/meetings/:meetingId/validate
 * Check if a meeting is valid and joinable (no auth required)
 * Useful for pre-flight checks before showing join screen
 */
router.get("/:meetingId/validate", async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    
    if (!meetingService.isValidMeetingId(meetingId)) {
      return res.json({ valid: false, reason: "Invalid meeting ID format" });
    }

    const result = await meetingService.canJoinMeeting(meetingId);
    res.json({ valid: result.allowed, ...result });
    
  } catch (error) {
    logger.error("GET /api/meetings/:meetingId/validate error:", error.message);
    next(error);
  }
});

/**
 * POST /api/meetings/:meetingId/cleanup
 * Clean up stale participants (mark all as left)
 * Useful for resetting a meeting's participant state
 */
router.post("/:meetingId/cleanup", async (req, res, next) => {
  try {
    const { meetingId } = req.params;
    
    if (!meetingService.isValidMeetingId(meetingId)) {
      return next(createError(400, "Invalid meeting ID format"));
    }

    // Import participant repository for cleanup
    const { participantRepository } = await import("../repositories/index.js");
    const count = await participantRepository.markAllLeft(meetingId);
    
    logger.info(`Cleaned up ${count} stale participants in meeting ${meetingId}`);
    res.json({ success: true, cleanedUp: count });
    
  } catch (error) {
    logger.error("POST /api/meetings/:meetingId/cleanup error:", error.message);
    next(error);
  }
});

export default router;

