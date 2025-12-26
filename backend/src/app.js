import express from "express";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import bodyParser from "body-parser";
import createError from "http-errors";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/auth.js";
import roomRoutes from "./routes/rooms.js";
import turnRoutes from "./routes/turn.js";
import webhookRoutes from "./routes/webhooks.js";
import { config } from "./config.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "../../frontend/dist");

app.use(helmet());
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (config.cors.allowedOrigins.length === 0) return callback(null, true);
      if (config.cors.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);
app.use(morgan("dev"));
app.use(bodyParser.json());

// Serve built frontend assets
app.use(express.static(distPath));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/rooms", roomRoutes);
app.use("/api/v1/turn", turnRoutes);
app.use("/api/v1/webhooks", webhookRoutes);

// Frontend entrypoints (embed and SPA)
app.get("/embed", (_req, res) => res.sendFile(path.join(distPath, "embed.html")));
app.get("/", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  return res.sendFile(path.join(distPath, "index.html"));
});

// 404 handler
app.use((_req, _res, next) => next(createError(404, "Not found")));

// error handler
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Server error" });
});

export default app;

