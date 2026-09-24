'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');

// PORT=0 asks the OS for a free port; server.js prints the one it got.
function port(raw) {
  if (raw === undefined || raw === '') return 8080;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 65535 ? value : 8080;
}

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  PAGES_DIR: path.join(ROOT, 'pages'),
  DATA_DIR: path.join(ROOT, 'data'),
  PORT: port(process.env.PORT),
  SESSION_TTL_MIN: Number(process.env.SESSION_TTL_MIN) || 30,
  SESSION_COOKIE: 'ASP.NET_SessionId',
  SUPERVISOR_CODE: process.env.SUPERVISOR_CODE || '482917',
  SUPERVISOR_THRESHOLD: 10000,
  DEMO_USER: 'operator',
  DEMO_PASSWORD: 'training',
};

module.exports.SESSION_TTL_MS = module.exports.SESSION_TTL_MIN * 60 * 1000;
