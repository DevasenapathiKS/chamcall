/**
 * Room ID Generator
 * Generates unique, human-readable room IDs in the format: abc-1234-xyz
 * - 3 lowercase letters
 * - 4 digits
 * - 3 lowercase letters
 * 
 * Example: abc-4821-xyz
 * 
 * Total combinations: 26^6 * 10^4 = 3,089,157,760,000 (over 3 trillion)
 */

import { meetingRepository } from "../repositories/index.js";
import { logger } from "./logger.js";

// Character sets for ID generation
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

/**
 * Generate a random string from a character set
 */
function randomString(chars, length) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a room ID in format: abc-1234-xyz
 */
function generateRoomIdPattern() {
  const prefix = randomString(LETTERS, 3);
  const middle = randomString(DIGITS, 4);
  const suffix = randomString(LETTERS, 3);
  return `${prefix}-${middle}-${suffix}`;
}

/**
 * Validate room ID format
 */
export function isValidRoomId(roomId) {
  if (!roomId || typeof roomId !== "string") return false;
  return /^[a-z]{3}-\d{4}-[a-z]{3}$/.test(roomId);
}

/**
 * Generate a unique room ID
 * Attempts to generate a unique ID, with retries if collision occurs
 * 
 * @param {string} appId - The application ID reserving this room
 * @param {number} maxAttempts - Maximum number of generation attempts
 * @returns {Promise<string>} - The unique room ID
 */
export async function generateUniqueRoomId(appId, maxAttempts = 10) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const roomId = generateRoomIdPattern();
    
    try {
      // Try to reserve this ID in the database
      const result = await meetingRepository.reserveRoomId(roomId, appId);
      
      if (result.success) {
        logger.info(`Generated unique room ID: ${roomId} (attempt ${attempt})`);
        return roomId;
      }
      
      // ID already exists, try again
      logger.debug(`Room ID collision: ${roomId}, retrying...`);
      
    } catch (error) {
      logger.error(`Room ID generation error (attempt ${attempt}):`, error.message);
      
      // If it's a duplicate key error, keep trying
      if (error.code === 11000) continue;
      
      // For other errors, throw
      throw error;
    }
  }
  
  throw new Error(`Failed to generate unique room ID after ${maxAttempts} attempts`);
}

/**
 * Generate a room ID without database check (for testing or fallback)
 * WARNING: This does not guarantee uniqueness - use generateUniqueRoomId in production
 */
export function generateRoomId() {
  return generateRoomIdPattern();
}

export default {
  generateUniqueRoomId,
  generateRoomId,
  isValidRoomId
};

