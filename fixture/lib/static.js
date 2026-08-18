'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { notFound } = require('./http');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.html': 'text/html; charset=iso-8859-1',
};

function serveStatic(req, res, urlPath) {
  const relative = urlPath.replace(/^\/public\/?/, '');
  if (!relative || relative.includes('\0')) {
    notFound(res);
    return;
  }

  const resolved = path.resolve(config.PUBLIC_DIR, relative);
  if (
    !resolved.startsWith(config.PUBLIC_DIR + path.sep) &&
    resolved !== config.PUBLIC_DIR
  ) {
    notFound(res);
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      notFound(res);
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
    });
    res.end(data);
  });
}

module.exports = { serveStatic };
