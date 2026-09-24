#!/usr/bin/env node
'use strict';

/**
 * Smoke test for the Legacy Console fixture.
 * Zero dependencies. Starts the server, hits key routes, exits non-zero on failure.
 *
 * Usage: node smoke.js
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 18080;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = __dirname;

function request(method, urlPath, opts) {
  const options = opts || {};
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: method,
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function cookieHeader(setCookie) {
  if (!setCookie) return '';
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function run() {
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'server.js')],
    {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(PORT),
        SUPERVISOR_CODE: '482917',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 5000);
    child.stdout.on('data', (buf) => {
      if (String(buf).includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('server exited early: ' + code));
    });
  });

  try {
    const ping = await request('GET', '/ping');
    assert(ping.status === 200 && ping.body === 'pong', 'GET /ping');

    const gate = await request('GET', '/');
    assert(gate.status === 302, 'GET / without session redirects');

    const loginPage = await request('GET', '/login');
    assert(loginPage.status === 200, 'GET /login');
    assert(loginPage.body.includes('Bank Test'), 'brand Bank Test');
    assert(loginPage.body.includes('operator'), 'demo credential visible');

    const login = await request('POST', '/login', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:
        'ctl00%24ContentPlaceHolder1%24txtUserId=operator' +
        '&ctl00%24ContentPlaceHolder1%24txtPassword=training' +
        '&ctl00%24ContentPlaceHolder1%24btnPrimary=Sign+On',
    });
    assert(login.status === 302, 'POST /login');
    const cookie = cookieHeader(login.headers['set-cookie']);
    assert(cookie.includes('ASP.NET_SessionId='), 'session cookie');

    const authHeaders = { Cookie: cookie };

    const badCookie = await request('GET', '/', { headers: { Cookie: 'a=%; ' + cookie } });
    assert(badCookie.status === 200, 'malformed cookie ignored');

    const shell = await request('GET', '/', { headers: authHeaders });
    assert(shell.status === 200, 'GET / shell');
    assert(shell.body.includes('name="content"'), 'iframe present');

    const search = await request('GET', '/member/search', { headers: authHeaders });
    assert(search.status === 200 && search.body.includes('Member ID'), 'member search');

    const results = await request('GET', '/member/results?memberId=10001', {
      headers: authHeaders,
    });
    assert(results.body.includes('Maria Santos'), 'results 10001');

    const empty = await request('GET', '/member/results?memberId=99999', {
      headers: authHeaders,
    });
    assert(empty.status === 200 && empty.body.includes('No records found.'), 'empty result');

    const denied = await request('GET', '/member/results?memberId=10009', {
      headers: authHeaders,
    });
    assert(denied.body.includes('not authorized'), 'restricted member');

    const detail = await request('GET', '/member/detail?memberId=10002', {
      headers: authHeaders,
    });
    assert(detail.body.includes('James Whitfield'), 'detail 10002');
    assert(detail.body.indexOf('Checking') < detail.body.indexOf('Savings'), 'savings not first');

    const fault = await request('POST', '/_fault', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'server_error' }),
    });
    assert(fault.body === 'armed:server_error', 'arm fault');
    const boom = await request('GET', '/member/search', { headers: authHeaders });
    assert(boom.status === 500 && boom.body.includes('System Error'), 'server_error fault');

    console.log('smoke OK');
  } finally {
    child.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('smoke FAILED:', err.message);
  process.exit(1);
});
