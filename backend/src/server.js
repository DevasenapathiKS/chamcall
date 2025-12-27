import http from "http";
import app from "./app.js";
import { config } from "./config.js";
import { createSocketServer } from "./socket/index.js";
import { logger } from "./utils/logger.js";

const server = http.createServer(app);

// Socket.IO CORS config
const socketCors = {
  origin: config.cors.allowedOrigins.length ? config.cors.allowedOrigins : "*",
  methods: ["GET", "POST"],
  credentials: true
};

createSocketServer(server, socketCors);

server.listen(config.port, () => {
  logger.info(`API and signaling listening on port ${config.port}`);
});

