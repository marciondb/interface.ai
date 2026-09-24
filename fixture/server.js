#!/usr/bin/env node
'use strict';

const config = require('./lib/config');
const { createApp, tenant, membersById } = require('./lib/app');

const server = createApp();

// Loopback only: the fixture has no real authentication and POST /_fault is open.
server.listen(config.PORT, '127.0.0.1', () => {
  // The bound port, which differs from the configured one when PORT=0.
  config.PORT = server.address().port;
  console.log(`Legacy Console listening on http://localhost:${config.PORT}`);
  console.log(`Tenant: ${tenant.key} (${tenant.displayName})`);
  console.log(`Members loaded: ${membersById.size}`);
  console.log(`Session TTL: ${config.SESSION_TTL_MIN} min`);
  console.log(`Sign on: http://localhost:${config.PORT}/login`);
});

module.exports = require('./lib/app');
