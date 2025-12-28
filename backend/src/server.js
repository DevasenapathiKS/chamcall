import http from "http";
import app from "./app.js";
import { config } from "./config.js";
import { createSocketServer } from "./socket/index.js";
import { logger } from "./utils/logger.js";
import { connectDB, disconnectDB } from "./db/connection.js";

const server = http.createServer(app);

// Socket.IO CORS config - allow all origins for development
const socketCors = {
  origin: "*",
  methods: ["GET", "POST"],
  credentials: false
};

createSocketServer(server, socketCors);

// Initialize MongoDB and start server
async function startServer() {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Start HTTP server
    server.listen(config.port, () => {
      logger.info(`API and signaling listening on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`JWT Auth: ${config.jwtAuthEnabled ? "enabled" : "disabled"}`);
    });
    
  } catch (error) {
    logger.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  
  server.close(async () => {
    logger.info("HTTP server closed");
    await disconnectDB();
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start the server
startServer();

