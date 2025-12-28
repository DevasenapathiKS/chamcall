import { Server } from "socket.io";
import { verifyToken } from "../services/tokenService.js";
import { getRoom, addParticipant, removeParticipant } from "../data/store.js";
import { logger } from "../utils/logger.js";
import { apps } from "../data/store.js";
import { dispatchWebhook } from "../webhooks/dispatcher.js";
import { config } from "../config.js";
import { participantRepository } from "../repositories/index.js";
import meetingService from "../services/meetingService.js";

/**
 * Socket.IO signaling server
 * 
 * Supports two modes:
 * 1. Legacy mode (with JWT): Uses in-memory room store
 * 2. Meeting mode (without JWT): Uses MongoDB meetings
 * 
 * Authentication is modular - when JWT is disabled, meetings can be
 * joined with just the meeting ID.
 */
export function createSocketServer(httpServer, corsConfig) {
  logger.info("Creating Socket.IO server with CORS:", JSON.stringify(corsConfig));
  
  const io = new Server(httpServer, {
    cors: corsConfig,
    transports: ["websocket", "polling"]
  });

  // Log all connection attempts
  io.engine.on("connection_error", (err) => {
    logger.error("Socket.IO connection error:", err.message, err.code, err.context);
  });

  // Authentication middleware - modular based on config
  io.use(async (socket, next) => {
    logger.info("Socket.IO middleware - checking auth");
    
    const token = socket.handshake.auth?.token;
    const meetingId = socket.handshake.auth?.meetingId;
    const userId = socket.handshake.auth?.userId;
    const userName = socket.handshake.auth?.name || "Guest";
    
    logger.info(`Auth params - token: ${!!token}, meetingId: ${meetingId}, userId: ${userId}`);
    
    // Mode 1: JWT token authentication (legacy rooms)
    if (token) {
      try {
        const claims = verifyToken(token);
        socket.data.claims = claims;
        socket.data.authMode = "jwt";
        logger.info("Socket.IO auth success (JWT) for user:", claims.sub);
        return next();
      } catch (err) {
        logger.error("Socket.IO JWT auth failed:", err.message);
        // If no meetingId fallback available, fail
        if (!meetingId || !userId) {
          return next(new Error("Invalid token"));
        }
        // Otherwise, fall through to meeting mode
        logger.info("Falling back to meeting mode auth...");
      }
    }
    
    // Mode 2: Meeting ID authentication (new meetings API - no JWT required)
    if (meetingId && userId) {
      try {
        // Validate meeting exists and is joinable
        const canJoin = await meetingService.canJoinMeeting(meetingId, userId);
        
        if (!canJoin.allowed) {
          logger.error(`Socket.IO meeting auth failed: ${canJoin.reason}`);
          return next(new Error(canJoin.reason));
        }
        
        // Set socket data for meeting mode
        socket.data.claims = {
          roomId: meetingId,
          sub: userId,
          name: userName,
          appId: "public"
        };
        socket.data.authMode = "meeting";
        logger.info(`Socket.IO auth success (meeting) for user: ${userId} in meeting: ${meetingId}`);
        return next();
        
      } catch (err) {
        logger.error("Socket.IO meeting auth error:", err.message);
        return next(new Error("Meeting validation failed"));
      }
    }
    
    // No valid auth provided
    logger.error("Socket.IO auth failed - no valid credentials provided");
    logger.error(`Received: token=${!!token}, meetingId=${meetingId}, userId=${userId}`);
    return next(new Error("Authentication required - provide token OR meetingId+userId"));
  });

  io.on("connection", async (socket) => {
    const { roomId, userId, appId, name } = {
      roomId: socket.data.claims.roomId,
      userId: socket.data.claims.sub,
      appId: socket.data.claims.appId,
      name: socket.data.claims.name
    };
    
    logger.info(`Socket connection - roomId: ${roomId}, userId: ${userId}, mode: ${socket.data.authMode}`);
    
    // Validate room based on auth mode
    if (socket.data.authMode === "jwt") {
      // Legacy: Check in-memory room store
      const room = getRoom(roomId);
      if (!room || room.appId !== appId) {
        logger.error(`Room validation failed - room exists: ${!!room}, appId match: ${room?.appId === appId}`);
        socket.disconnect(true);
        return;
      }
      addParticipant(roomId, { userId, name, role: socket.data.claims.role });
      const app = apps.get(appId);
      dispatchWebhook({ app, event: "user.joined", payload: { roomId, userId } }).catch(() => {});
    } else {
      // Meeting mode: Update participant status in MongoDB
      try {
        await participantRepository.updateStatus(roomId, userId, "connected");
      } catch (err) {
        logger.warn("Failed to update participant status:", err.message);
      }
    }
    
    // Join Socket.IO room
    socket.join(roomId);
    
    // Get count of sockets in this room
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    const socketCount = roomSockets ? roomSockets.size : 0;
    logger.info(`User ${userId} joined room ${roomId}. Total sockets in room: ${socketCount}`);
    
    // Notify other participants
    socket.to(roomId).emit("user-joined", { userId, name });
    logger.info(`Emitted user-joined to room ${roomId} for user ${userId}`);

    // WebRTC signaling events
    socket.on("webrtc-offer", (payload) => {
      logger.info(`Received offer from ${userId} in room ${roomId}`);
      socket.to(roomId).emit("webrtc-offer", { from: userId, payload });
    });
    
    socket.on("webrtc-answer", (payload) => {
      logger.info(`Received answer from ${userId} in room ${roomId}`);
      socket.to(roomId).emit("webrtc-answer", { from: userId, payload });
    });
    
    socket.on("ice-candidate", (payload) => {
      logger.debug(`Received ICE candidate from ${userId} in room ${roomId}`);
      socket.to(roomId).emit("ice-candidate", { from: userId, payload });
    });

    // Media state updates (mute/camera) for UX parity
    socket.on("user-media-updated", async ({ audio, video }) => {
      socket.to(roomId).emit("user-media-updated", { userId, audio, video });
      
      // Update participant media state in DB if using meetings
      if (socket.data.authMode === "meeting") {
        try {
          await participantRepository.updateMediaState(roomId, userId, {
            audioEnabled: audio,
            videoEnabled: video
          });
        } catch (err) {
          logger.warn("Failed to update media state:", err.message);
        }
      }
    });

    // Screen share signals (tracks are swapped in WebRTC; this is for UI state)
    socket.on("screen-share-started", async () => {
      socket.to(roomId).emit("screen-share-started", { userId });
      
      if (socket.data.authMode === "meeting") {
        try {
          await participantRepository.updateMediaState(roomId, userId, { screenSharing: true });
        } catch (err) {
          logger.warn("Failed to update screen share state:", err.message);
        }
      }
    });
    
    socket.on("screen-share-stopped", async () => {
      socket.to(roomId).emit("screen-share-stopped", { userId });
      
      if (socket.data.authMode === "meeting") {
        try {
          await participantRepository.updateMediaState(roomId, userId, { screenSharing: false });
        } catch (err) {
          logger.warn("Failed to update screen share state:", err.message);
        }
      }
    });

    socket.on("disconnect", async () => {
      socket.to(roomId).emit("user-left", { userId });
      
      if (socket.data.authMode === "jwt") {
        removeParticipant(roomId, userId);
        const app = apps.get(appId);
        dispatchWebhook({ app, event: "user.left", payload: { roomId, userId } }).catch(() => {});
      } else {
        // Update participant status in MongoDB
        try {
          await meetingService.leaveMeeting(roomId, userId);
        } catch (err) {
          logger.warn("Failed to update leave status:", err.message);
        }
      }
      
      logger.info(`User ${userId} left room ${roomId}`);
    });
  });

  return io;
}

