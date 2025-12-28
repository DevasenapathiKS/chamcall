/**
 * Modular Authentication Middleware
 * 
 * Provides flexible authentication that can be:
 * - Enabled/disabled via config
 * - Required or optional per route
 * - App-level (API keys) or user-level (JWT)
 * 
 * This allows meeting access to work without JWT while keeping
 * JWT infrastructure in place for future re-enablement.
 */

import createError from "http-errors";
import { config } from "../config.js";
import { verifyToken } from "../services/tokenService.js";
import { apps } from "../data/store.js";
import { logger } from "../utils/logger.js";

/**
 * Check if authentication is globally enabled
 */
export function isAuthEnabled() {
  return config.jwtAuthEnabled;
}

/**
 * Extract app credentials from headers
 */
function extractAppCredentials(req) {
  const appId = req.headers["x-app-id"];
  const appKey = req.headers["x-app-key"];
  return { appId, appKey };
}

/**
 * Extract JWT token from request
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * Validate app credentials (API key authentication)
 */
function validateAppCredentials(appId, appKey) {
  if (!appId || !appKey) return null;
  
  const app = apps.get(appId);
  if (!app) return null;
  if (app.appSecret !== appKey) return null;
  
  return app;
}

/**
 * Validate JWT token
 */
function validateJwtToken(token) {
  if (!token) return null;
  
  try {
    return verifyToken(token);
  } catch (error) {
    return null;
  }
}

/**
 * Middleware: Require authentication (app key OR JWT)
 * Use this for API endpoints that need to identify the caller
 */
export function requireAuth(req, res, next) {
  // Try app credentials first
  const { appId, appKey } = extractAppCredentials(req);
  const app = validateAppCredentials(appId, appKey);
  
  if (app) {
    req.appContext = { app, appId };
    return next();
  }
  
  // Try JWT token
  const token = extractToken(req);
  const claims = validateJwtToken(token);
  
  if (claims) {
    req.token = claims;
    req.appContext = { appId: claims.appId };
    return next();
  }
  
  // If auth is disabled, allow through with minimal context
  if (!isAuthEnabled()) {
    logger.debug("Auth disabled - allowing request without credentials");
    req.appContext = { appId: "default-app" };
    return next();
  }
  
  return next(createError(401, "Authentication required"));
}

/**
 * Middleware: Optional authentication
 * Attaches auth context if present, but doesn't require it
 */
export function optionalAuth(req, res, next) {
  // Try app credentials
  const { appId, appKey } = extractAppCredentials(req);
  const app = validateAppCredentials(appId, appKey);
  
  if (app) {
    req.appContext = { app, appId };
    return next();
  }
  
  // Try JWT token
  const token = extractToken(req);
  const claims = validateJwtToken(token);
  
  if (claims) {
    req.token = claims;
    req.appContext = { appId: claims.appId };
    return next();
  }
  
  // No auth - that's okay for optional auth
  req.appContext = { appId: "public" };
  return next();
}

/**
 * Middleware: Require app-level authentication only
 * For admin/management endpoints
 */
export function requireAppAuth(req, res, next) {
  const { appId, appKey } = extractAppCredentials(req);
  const app = validateAppCredentials(appId, appKey);
  
  if (app) {
    req.appContext = { app, appId };
    return next();
  }
  
  if (!isAuthEnabled()) {
    logger.debug("Auth disabled - allowing app request without credentials");
    req.appContext = { appId: "default-app", app: apps.get("demo-app") };
    return next();
  }
  
  return next(createError(401, "App authentication required"));
}

/**
 * Middleware: Meeting access (no auth required when disabled)
 * Specifically for meeting join flows
 * 
 * When JWT is disabled:
 * - Allows access with just meeting ID
 * - Still extracts auth if provided
 * 
 * When JWT is enabled:
 * - Requires valid authentication
 */
export function meetingAccess(req, res, next) {
  // Always try to extract auth context
  const { appId, appKey } = extractAppCredentials(req);
  const app = validateAppCredentials(appId, appKey);
  
  if (app) {
    req.appContext = { app, appId };
    return next();
  }
  
  const token = extractToken(req);
  const claims = validateJwtToken(token);
  
  if (claims) {
    req.token = claims;
    req.appContext = { appId: claims.appId };
    return next();
  }
  
  // Meeting access allowed without auth when JWT is disabled
  if (!isAuthEnabled()) {
    req.appContext = { appId: "public", isAnonymous: true };
    return next();
  }
  
  return next(createError(401, "Authentication required to join meeting"));
}

/**
 * Export legacy middleware for backward compatibility
 */
export const requireAppOrJwt = requireAuth;

export default {
  requireAuth,
  optionalAuth,
  requireAppAuth,
  meetingAccess,
  isAuthEnabled
};

