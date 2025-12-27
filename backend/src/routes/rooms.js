import express from "express";
import createError from "http-errors";
import { requireAppOrJwt } from "../middleware/auth.js";
import { apps, createRoom, getRoom, addParticipant, getParticipants } from "../data/store.js";
import { signRoomToken } from "../services/tokenService.js";
import { generateTurnCredentials } from "../utils/crypto.js";

const router = express.Router();

router.post("/", requireAppOrJwt, (req, res, next) => {
  const appId = req.token?.appId || req.appContext?.app?.appId;
  if (!appId) return next(createError(401, "Unknown app"));
  const room = createRoom(appId, req.body?.createdBy || "system", req.body?.metadata);
  res.status(201).json({ roomId: room.id, status: room.status });
});

router.post("/:roomId/join", requireAppOrJwt, (req, res, next) => {
  const appId = req.token?.appId || req.appContext?.app?.appId;
  const { roomId } = req.params;
  const room = getRoom(roomId);
  if (!room || room.appId !== appId) return next(createError(404, "Room not found"));
  const user = { id: req.body.userId, name: req.body.name, role: req.body.role || "participant" };
  if (!user.id) return next(createError(400, "userId required"));
  addParticipant(roomId, { userId: user.id, name: user.name, role: user.role });
  const token = signRoomToken({ appId, roomId, user: { id: user.id, name: user.name, role: user.role } });
  const turn = generateTurnCredentials(appId);

  // Socket.IO client expects HTTP/HTTPS URL (it handles ws upgrade internally)
  const forwardedProto = req.headers["x-forwarded-proto"];
  const baseProto = forwardedProto ? forwardedProto.split(",")[0] : req.protocol;
  const host = req.get("host");

  res.json({
    roomId,
    token,
    // Socket.IO client uses path "/ws"; return HTTP URL (not ws://)
    signalingUrl: `${baseProto}://${host}`,
    iceServers: [
      ...turn.urls.map((u) => ({ urls: [u], username: turn.username, credential: turn.credential }))
    ],
    ttl: turn.ttl
  });
});

router.get("/:roomId/status", requireAppOrJwt, (req, res, next) => {
  const appId = req.token?.appId || req.appContext?.app?.appId;
  const { roomId } = req.params;
  const room = getRoom(roomId);
  if (!room || room.appId !== appId) return next(createError(404, "Room not found"));
  const participants = getParticipants(roomId);
  res.json({ roomId, status: room.status, participants });
});

export default router;

