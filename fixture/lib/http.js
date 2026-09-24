'use strict';

const config = require('./config');
const { stripPrimarySubmit, escapeHtml } = require('./template');
const sessionStore = require('./session');

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      // A malformed cookie is ignored, as if it had not been sent.
    }
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function parseForm(body) {
  const params = new URLSearchParams(body);
  const out = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

function queryParam(req, name) {
  const host = req.headers.host || `localhost:${config.PORT}`;
  try {
    return new URL(req.url || '/', `http://${host}`).searchParams.get(name) || '';
  } catch (_err) {
    return '';
  }
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

function sendHtml(res, html, statusCode, extraHeaders) {
  let body = html;
  if (res.__stripPrimary) {
    body = stripPrimarySubmit(body);
    res.__stripPrimary = false;
  }
  const headers = Object.assign(
    { 'Content-Type': 'text/html; charset=iso-8859-1' },
    extraHeaders || {}
  );
  res.writeHead(statusCode || 200, headers);
  res.end(body);
}

function sendText(res, text, statusCode) {
  res.writeHead(statusCode || 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(text);
}

function redirect(res, location, extraHeaders) {
  const headers = Object.assign({ Location: location }, extraHeaders || {});
  res.writeHead(302, headers);
  res.end();
}

function loginErrorHtml(message) {
  return (
    '<tr><td colspan="2">' +
    `<font color="#CC0000" size="2">${escapeHtml(message)}</font>` +
    '</td></tr>'
  );
}

function fieldErrorHtml(message) {
  return (
    '<tr><td colspan="3">' +
    `<font color="#CC0000" size="2">${escapeHtml(message)}</font>` +
    '</td></tr>'
  );
}

module.exports = {
  parseCookies,
  readBody,
  parseForm,
  queryParam,
  notFound,
  sendHtml,
  sendText,
  redirect,
  loginErrorHtml,
  fieldErrorHtml,
  sessionCookieHeader: sessionStore.sessionCookieHeader,
  clearSessionCookieHeader: sessionStore.clearSessionCookieHeader,
};
