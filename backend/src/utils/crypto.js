import crypto from "crypto";
import { config } from "../config.js";

export function hmacSha256(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function generateTurnCredentials(appId) {
  const timestamp = Math.floor(Date.now() / 1000) + config.turn.ttlSeconds;
  const username = `${timestamp}:${appId}`;
  const credential = crypto
    .createHmac("sha1", config.turn.staticSecret)
    .update(username)
    .digest("base64");
  return {
    username,
    credential,
    ttl: config.turn.ttlSeconds,
    urls: config.turn.urls
  };
}

