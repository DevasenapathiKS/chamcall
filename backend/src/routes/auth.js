import express from "express";
import createError from "http-errors";
import { apps } from "../data/store.js";
import { signAppToken } from "../services/tokenService.js";

const router = express.Router();

router.post("/token", (req, res, next) => {
  const { appId, appSecret, user } = req.body || {};
  const app = apps.get(appId);
  if (!app || app.appSecret !== appSecret) return next(createError(401, "Invalid app credentials"));
  const token = signAppToken(appId, user);
  res.json({ token, expiresIn: 3600 });
});

export default router;

