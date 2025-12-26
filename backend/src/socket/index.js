import { Server } from "socket.io";
import { verifyToken } from "../services/tokenService.js";
import { getRoom, addParticipant, removeParticipant } from "../data/store.js";
import { logger } from "../utils/logger.js";
import { apps } from "../data/store.js";
import { dispatchWebhook } from "../webhooks/dispatcher.js";

export function createSocketServer(httpServer, corsConfig) {
  const io = new Server(httpServer, {
    path: "/ws",
    cors: corsConfig
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing token"));
    try {
      const claims = verifyToken(token);
      socket.data.claims = claims;
      return next();
    } catch (_err) {
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
    const room = getRoom(roomId);
    if (!room || room.appId !== appId) {
      socket.disconnect(true);
      return;
    }
    socket.join(roomId);
    addParticipant(roomId, { userId, name, role: socket.data.claims.role });
    const app = apps.get(appId);
    dispatchWebhook({ app, event: "user.joined", payload: { roomId, userId } }).catch(() => {});
    logger.info(`socket joined ${roomId}`, userId);
    socket.to(roomId).emit("user-joined", { userId, name });

    socket.on("webrtc-offer", (payload) => socket.to(roomId).emit("webrtc-offer", { from: userId, payload }));
    socket.on("webrtc-answer", (payload) => socket.to(roomId).emit("webrtc-answer", { from: userId, payload }));
    socket.on("ice-candidate", (payload) =>
      socket.to(roomId).emit("ice-candidate", { from: userId, payload })
    );

    socket.on("disconnect", () => {
      removeParticipant(roomId, userId);
      socket.to(roomId).emit("user-left", { userId });
      dispatchWebhook({ app, event: "user.left", payload: { roomId, userId } }).catch(() => {});
      logger.info(`socket left ${roomId}`, userId);
    });
  });

  return io;
}

