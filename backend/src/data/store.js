import { v4 as uuid } from "uuid";

// In-memory placeholder storage; replace with database in production.
export const apps = new Map();
export const rooms = new Map();
export const participants = new Map(); // roomId -> array

// Seed with a demo app for quickstart.
const demoAppId = "demo-app";
apps.set(demoAppId, {
  appId: demoAppId,
  appSecret: "demo-secret",
  allowedDomains: ["*"],
  webhookUrl: null,
  webhookSecret: "demo-webhook"
});

export function createRoom(appId, createdBy, metadata = {}) {
  const id = `room_${uuid().slice(0, 8)}`;
  const room = {
    id,
    appId,
    status: "created",
    createdBy,
    createdAt: new Date().toISOString(),
    metadata
  };
  rooms.set(id, room);
  participants.set(id, []);
  return room;
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function addParticipant(roomId, user) {
  const list = participants.get(roomId) || [];
  list.push({ ...user, joinedAt: new Date().toISOString() });
  participants.set(roomId, list);
  return list;
}

export function removeParticipant(roomId, userId) {
  const list = participants.get(roomId) || [];
  const filtered = list.filter((p) => p.userId !== userId);
  participants.set(roomId, filtered);
  return filtered;
}

export function getParticipants(roomId) {
  return participants.get(roomId) || [];
}

