import { hmacSha256 } from "../utils/crypto.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return res;
}

export async function dispatchWebhook({ app, event, payload }) {
  if (!app.webhookUrl) {
    logger.info("Webhook skipped; not configured", app.appId, event);
    return;
  }
  const timestamp = Date.now().toString();
  const secret = app.webhookSecret || config.webhook.defaultSecret;
  const signature = hmacSha256(`${timestamp}.${JSON.stringify(payload)}`, secret);
  const headers = {
    "X-App-Id": app.appId,
    "X-Event": event,
    "X-Timestamp": timestamp,
    "X-Signature": `sha256=${signature}`
  };
  const schedule = config.webhook.retryScheduleSeconds;
  let attempt = 0;
  // Simple inline retry for demo; replace with queue/worker for production.
  for (const waitSec of schedule) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, waitSec * 1000));
    attempt += 1;
    try {
      const res = await postJson(app.webhookUrl, payload, headers);
      if (res.ok) {
        logger.info(`Webhook delivered ${event} to ${app.webhookUrl}`);
        return;
      }
      logger.warn(`Webhook attempt ${attempt} failed with status ${res.status}`);
    } catch (err) {
      logger.error("Webhook attempt error", err.message);
    }
  }
  logger.error(`Webhook failed after ${attempt} attempts`, event, app.webhookUrl);
}

