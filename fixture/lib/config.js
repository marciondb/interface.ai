'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  PAGES_DIR: path.join(ROOT, 'pages'),
  DATA_DIR: path.join(ROOT, 'data'),
  PORT: Number(process.env.PORT) || 8080,
  SESSION_TTL_MIN: Number(process.env.SESSION_TTL_MIN) || 30,
  SESSION_COOKIE: 'ASP.NET_SessionId',
  SUPERVISOR_CODE: process.env.SUPERVISOR_CODE || '482917',
  SUPERVISOR_THRESHOLD: 10000,
  DEMO_USER: 'operator',
  DEMO_PASSWORD: 'training',
};

module.exports.SESSION_TTL_MS = module.exports.SESSION_TTL_MIN * 60 * 1000;
