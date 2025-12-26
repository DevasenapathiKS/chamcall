import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET || "dev-jwt-secret",
  appJwtAudience: process.env.JWT_AUDIENCE || "webrtc-api",
  turn: {
    staticSecret: process.env.TURN_STATIC_SECRET || "change-me",
    ttlSeconds: Number(process.env.TURN_TTL_SECONDS || 600),
    urls: (process.env.TURN_URLS || "turn:turn.local:3478,stun:turn.local:3478")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean)
  },
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean)
  },
  webhook: {
    retryScheduleSeconds: [0, 30, 120, 600, 1800],
    defaultSecret: process.env.WEBHOOK_SECRET || "webhook-secret"
  }
};

