'use strict';

const http = require('http');
const config = require('./config');
const { membersById } = require('./members');
const sessionStore = require('./session');
const { tenant, renderPage } = require('./template');
const { parseCookies, sendHtml, redirect, notFound, clearSessionCookieHeader } = require('./http');
const { serveStatic } = require('./static');
const { getArmedFault, clearArmedFault, isFaultExempt } = require('./faults');
const { createRoutes, createDispatch } = require('./routes');
const { generateAccountNumber } = require('./views/subacct');

function sendServerError(res) {
  sendHtml(res, renderPage('error-500.html', {}), 500);
}

function createApp() {
  const routes = createRoutes();
  const dispatch = createDispatch(routes);

  const server = http.createServer((req, res) => {
    const host = req.headers.host || `localhost:${config.PORT}`;
    let pathname;
    let fullUrl;
    try {
      fullUrl = new URL(req.url || '/', `http://${host}`);
      pathname = fullUrl.pathname;
    } catch (_err) {
      notFound(res);
      return;
    }

    if (pathname === '/public' || pathname.startsWith('/public/')) {
      serveStatic(req, res, pathname);
      return;
    }

    if (req.method === 'GET' && pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    const armedFault = getArmedFault();
    if (!isFaultExempt(pathname) && armedFault) {
      const kind = armedFault;

      if (kind === 'session_expired') {
        clearArmedFault();
        const cookies = parseCookies(req.headers.cookie);
        sessionStore.destroySession(cookies[config.SESSION_COOKIE]);
        redirect(res, '/login', {
          'Set-Cookie': clearSessionCookieHeader(),
        });
        return;
      }

      if (kind === 'server_error') {
        clearArmedFault();
        sendServerError(res);
        return;
      }

      if (kind === 'interstitial') {
        clearArmedFault();
        const continuePath = fullUrl.pathname + fullUrl.search;
        sendHtml(
          res,
          renderPage('interstitial.html', {
            continuePath: continuePath,
          })
        );
        return;
      }

      if (kind === 'slow_load') {
        clearArmedFault();
        setTimeout(() => {
          dispatch(req, res, pathname);
        }, 8000);
        return;
      }

      if (kind === 'element_missing') {
        clearArmedFault();
        res.__stripPrimary = true;
        dispatch(req, res, pathname);
        return;
      }
    }

    dispatch(req, res, pathname);
  });

  return server;
}

module.exports = {
  createApp,
  createSession: sessionStore.createSession,
  getSession: sessionStore.getSession,
  destroySession: sessionStore.destroySession,
  SESSION_TTL_MS: config.SESSION_TTL_MS,
  sessions: sessionStore.sessions,
  generateAccountNumber,
  tenant,
  membersById,
};
