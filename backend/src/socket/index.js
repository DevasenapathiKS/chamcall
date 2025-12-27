import { Server } from "socket.io";
import { verifyToken } from "../services/tokenService.js";
import { getRoom, addParticipant, removeParticipant } from "../data/store.js";
import { logger } from "../utils/logger.js";
import { apps } from "../data/store.js";
import { dispatchWebhook } from "../webhooks/dispatcher.js";

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

  io.use((socket, next) => {
    logger.info("Socket.IO middleware - checking auth token");
    const token = socket.handshake.auth?.token;
    if (!token) {
      logger.error("Socket.IO auth failed - no token provided");
      return next(new Error("Missing token"));
    }
    try {
      const claims = verifyToken(token);
      socket.data.claims = claims;
      logger.info("Socket.IO auth success for user:", claims.sub);
      return next();
    } catch (err) {
      logger.error("Socket.IO auth failed - invalid token:", err.message);
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const { roomId, userId, appId, name } = {
      roomId: socket.data.claims.roomId,
      userId: socket.data.claims.sub,
      appId: socket.data.claims.appId,
      name: socket.data.claims.name
    };
    
    logger.info(`Socket connection attempt - roomId: ${roomId}, userId: ${userId}, appId: ${appId}`);
    
    const room = getRoom(roomId);
    if (!room || room.appId !== appId) {
      logger.error(`Room validation failed - room exists: ${!!room}, appId match: ${room?.appId === appId}`);
      socket.disconnect(true);
      return;
    }
    
    socket.join(roomId);
    addParticipant(roomId, { userId, name, role: socket.data.claims.role });
    const app = apps.get(appId);
    dispatchWebhook({ app, event: "user.joined", payload: { roomId, userId } }).catch(() => {});
    
    // Get count of sockets in this room
    const roomSockets = io.sockets.adapter.rooms.get(roomId);
    const socketCount = roomSockets ? roomSockets.size : 0;
    logger.info(`User ${userId} joined room ${roomId}. Total sockets in room: ${socketCount}`);
    
    // Notify other participants
    socket.to(roomId).emit("user-joined", { userId, name });
    logger.info(`Emitted user-joined to room ${roomId} for user ${userId}`);

    socket.on("webrtc-offer", (payload) => {
      logger.info(`Received offer from ${userId} in room ${roomId}`);
      socket.to(roomId).emit("webrtc-offer", { from: userId, payload });
    });
    
    socket.on("webrtc-answer", (payload) => {
      logger.info(`Received answer from ${userId} in room ${roomId}`);
      socket.to(roomId).emit("webrtc-answer", { from: userId, payload });
    });
    
    socket.on("ice-candidate", (payload) => {
      logger.info(`Received ICE candidate from ${userId} in room ${roomId}`);
      socket.to(roomId).emit("ice-candidate", { from: userId, payload });
    });

    // Media state updates (mute/camera) for UX parity
    socket.on("user-media-updated", ({ audio, video }) => {
      socket.to(roomId).emit("user-media-updated", { userId, audio, video });
    });

    // Screen share signals (tracks are swapped in WebRTC; this is for UI state)
    socket.on("screen-share-started", () => {
      socket.to(roomId).emit("screen-share-started", { userId });
    });
    socket.on("screen-share-stopped", () => {
      socket.to(roomId).emit("screen-share-stopped", { userId });
    });

    socket.on("disconnect", () => {
      removeParticipant(roomId, userId);
      socket.to(roomId).emit("user-left", { userId });
      dispatchWebhook({ app, event: "user.left", payload: { roomId, userId } }).catch(() => {});
      logger.info(`socket left ${roomId}`, userId);
    });
  });

  return io;
}

