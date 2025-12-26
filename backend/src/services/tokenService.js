import jwt from "jsonwebtoken";
import createError from "http-errors";
import { config } from "../config.js";
import { apps } from "../data/store.js";

export function signAppToken(appId, user) {
  const app = apps.get(appId);
  if (!app) throw createError(401, "Invalid app");
  const payload = {
    sub: user?.id || appId,
    appId,
    role: user?.role || "app",
    name: user?.name,
    aud: config.appJwtAudience
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "1h" });
}

export function signRoomToken({ appId, roomId, user }) {
  if (!apps.has(appId)) throw createError(401, "Invalid app");
  const payload = {
    sub: user.id,
    appId,
    roomId,
    role: user.role || "participant",
    name: user.name,
    aud: config.appJwtAudience
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "1h" });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { audience: config.appJwtAudience });
  } catch (err) {
    throw createError(401, "Invalid token");
  }
}

