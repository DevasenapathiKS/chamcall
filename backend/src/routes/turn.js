import express from "express";
import { requireAppOrJwt } from "../middleware/auth.js";
import { generateTurnCredentials } from "../utils/crypto.js";

const router = express.Router();

router.post("/credentials", requireAppOrJwt, (req, res) => {
  const appId = req.token?.appId || req.appContext?.app?.appId;
  const turn = generateTurnCredentials(appId);
  res.json({
    iceServers: turn.urls.map((u) => ({ urls: [u], username: turn.username, credential: turn.credential })),
    ttl: turn.ttl
  });
});

export default router;

