'use strict';

const crypto = require('crypto');
const config = require('./config');

const sessions = new Map();

function createSession() {
  const id = crypto.randomBytes(16).toString('hex');
  sessions.set(id, {
    createdAt: Date.now(),
    userId: config.DEMO_USER,
    pendingSubAcct: null,
  });
  return id;
}

/** @param {string|undefined|null} id @param {number} [now] */
function getSession(id, now) {
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  const clock = now === undefined ? Date.now() : now;
  if (clock - session.createdAt > config.SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return session;
}

function destroySession(id) {
  if (id) sessions.delete(id);
}

function sessionCookieHeader(sessionId) {
  const maxAge = Math.floor(config.SESSION_TTL_MS / 1000);
  return `${config.SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Max-Age=${maxAge}`;
}

function clearSessionCookieHeader() {
  return `${config.SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`;
}

module.exports = {
  sessions,
  createSession,
  getSession,
  destroySession,
  sessionCookieHeader,
  clearSessionCookieHeader,
};
