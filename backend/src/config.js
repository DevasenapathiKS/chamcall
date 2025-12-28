import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || "development",
  
  // MongoDB
  mongoUri: process.env.MONGO_URI || "mongodb+srv://devahari6465:l6MGWKtq303sbVv9@devahari6465.vok7c.mongodb.net/chamcall_test?retryWrites=true&w=majority&appName=devahari6465",
  
  // JWT (modular - can be disabled for meeting access)
  jwtSecret: process.env.JWT_SECRET || "dev-jwt-secret",
  appJwtAudience: process.env.JWT_AUDIENCE || "webrtc-api",
  jwtAuthEnabled: process.env.JWT_AUTH_ENABLED !== "true", // Default: enabled
  
  // Meeting settings
  meeting: {
    // Meeting link base URL for external sharing
    baseUrl: process.env.MEETING_BASE_URL || "https://vc.valliams.com/meet",
    // Default meeting duration in minutes
    defaultDurationMinutes: Number(process.env.DEFAULT_MEETING_DURATION || 60),
    // Meeting expiry buffer (how long after scheduled end time before expiry)
    expiryBufferMinutes: Number(process.env.MEETING_EXPIRY_BUFFER || 30)
  },
  
  // TURN/STUN
  turn: {
    staticSecret: process.env.TURN_STATIC_SECRET || "change-me",
    ttlSeconds: Number(process.env.TURN_TTL_SECONDS || 600),
    urls: (process.env.TURN_URLS || "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean)
  },
  
  // CORS
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean)
  },
  
  // Webhooks
  webhook: {
    retryScheduleSeconds: [0, 30, 120, 600, 1800],
    defaultSecret: process.env.WEBHOOK_SECRET || "webhook-secret"
  }
};

