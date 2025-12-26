import express from "express";
import createError from "http-errors";
import { requireAppOrJwt } from "../middleware/auth.js";
import { apps } from "../data/store.js";
import { dispatchWebhook } from "../webhooks/dispatcher.js";

const router = express.Router();

router.post("/subscribe", requireAppOrJwt, (req, res, next) => {
  const appId = req.token?.appId || req.appContext?.app?.appId;
  const app = apps.get(appId);
  if (!app) return next(createError(404, "App not found"));
  app.webhookUrl = req.body.url;
  app.webhookSecret = req.body.secret || app.webhookSecret;
  apps.set(appId, app);
  res.json({ ok: true, webhookUrl: app.webhookUrl });
});

router.post("/test", requireAppOrJwt, async (req, res, next) => {
  const appId = req.token?.appId || req.appContext?.app?.appId;
  const app = apps.get(appId);
  if (!app || !app.webhookUrl) return next(createError(400, "Webhook not configured"));
  await dispatchWebhook({ app, event: "test.event", payload: { hello: "world" } });
  res.json({ ok: true });
});

export default router;

