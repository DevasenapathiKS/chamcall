import createError from "http-errors";
import { apps } from "../data/store.js";
import { verifyToken } from "../services/tokenService.js";

export function requireAppKey(req, _res, next) {
  const appId = req.header("X-App-Id");
  const appKey = req.header("X-App-Key");
  if (!appId || !appKey) return next(createError(401, "Missing app credentials"));
  const app = apps.get(appId);
  if (!app || app.appSecret !== appKey) return next(createError(401, "Invalid app credentials"));
  req.appContext = { app };
  next();
}

export function requireJwt(req, _res, next) {
  const auth = req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return next(createError(401, "Missing token"));
  const token = auth.replace("Bearer ", "");
  const claims = verifyToken(token);
  req.token = claims;
  next();
}

export function requireAppOrJwt(req, res, next) {
  const auth = req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    return requireJwt(req, res, next);
  }
  return requireAppKey(req, res, next);
}

