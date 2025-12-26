import http from "http";
import app from "./app.js";
import { config } from "./config.js";
import { createSocketServer } from "./socket/index.js";
import { logger } from "./utils/logger.js";

const server = http.createServer(app);
createSocketServer(server, { origin: config.cors.allowedOrigins.length ? config.cors.allowedOrigins : "*" });

server.listen(config.port, () => {
  logger.info(`API and signaling listening on port ${config.port}`);
});

