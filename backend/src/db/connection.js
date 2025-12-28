/**
 * MongoDB Connection Module
 * Handles database connection with retry logic and graceful shutdown
 */

import mongoose from "mongoose";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let isConnected = false;

/**
 * Connect to MongoDB with retry logic
 */
export async function connectDB() {
  if (isConnected) {
    logger.info("MongoDB already connected");
    return;
  }

  try {
    const options = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    await mongoose.connect(config.mongoUri, options);
    isConnected = true;
    logger.info("MongoDB connected successfully");

    // Handle connection events
    mongoose.connection.on("error", (err) => {
      logger.error("MongoDB connection error:", err);
      isConnected = false;
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected");
      isConnected = false;
    });

    mongoose.connection.on("reconnected", () => {
      logger.info("MongoDB reconnected");
      isConnected = true;
    });

  } catch (error) {
    logger.error("MongoDB connection failed:", error.message);
    // Retry connection after 5 seconds
    logger.info("Retrying MongoDB connection in 5 seconds...");
    setTimeout(connectDB, 5000);
  }
}

/**
 * Gracefully close MongoDB connection
 */
export async function disconnectDB() {
  if (!isConnected) return;
  
  try {
    await mongoose.connection.close();
    isConnected = false;
    logger.info("MongoDB connection closed");
  } catch (error) {
    logger.error("Error closing MongoDB connection:", error.message);
  }
}

/**
 * Check if MongoDB is connected
 */
export function isDBConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

export default mongoose;

