'use strict';

/**
 * Legacy Console — HTTP server.
 *
 * Zero npm dependencies. Node built-ins only.
 *
 * ---------------------------------------------------------------------------
 * Primary submit convention (Stage 0.6)
 * ---------------------------------------------------------------------------
 * Every screen's primary submit control MUST include the template token
 * {{primarySubmit}} among its attributes. The renderer expands that token to:
 *
 *   id="<tenantIdPrefix>btnPrimary" name="<tenantNamePrefix>btnPrimary"
 *
 * Stage 9's element_missing fault injection will remove the control that
 * carries this id. Nothing else consumes the marker yet — it exists so every
 * screen is already wired the same way when that injection is built.
 *
 * Do not invent a second way to mark primary submits. Do not use aria-*,
 * role=, or data-testid for this purpose.
 * ---------------------------------------------------------------------------
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getTenant } = require('./tenants');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PAGES_DIR = path.join(ROOT, 'pages');
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 8080;
const SESSION_TTL_MIN = Number(process.env.SESSION_TTL_MIN) || 30;
const SESSION_TTL_MS = SESSION_TTL_MIN * 60 * 1000;
const SESSION_COOKIE = 'ASP.NET_SessionId';
const SUPERVISOR_CODE = process.env.SUPERVISOR_CODE || '482917';
const SUPERVISOR_THRESHOLD = 10000;

// Deliberately fixed demo credentials — also printed on the login page.
const DEMO_USER = 'operator';
const DEMO_PASSWORD = 'training';

const tenant = getTenant();

/** @type {Map<string, object>} */
const membersById = loadMembers();

/** @type {object[]} */
const subAccountRequests = [];

/** Armed one-shot runtime fault, or null. */
let armedFault = null;

function loadMembers() {
  const filePath = path.join(DATA_DIR, 'members.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const list = JSON.parse(raw);
  const map = new Map();
  for (const member of list) {
    map.set(String(member.id), member);
  }
  return map;
}

function findMember(memberId) {
  return membersById.get(String(memberId)) || null;
}

function queryParam(req, name) {
  const host = req.headers.host || `localhost:${PORT}`;
  try {
    return new URL(req.url || '/', `http://${host}`).searchParams.get(name) || '';
  } catch (_err) {
    return '';
  }
}

const ACCOUNT_COLUMN_HEADERS = {
  type: 'Acct Type',
  number: 'Acct Number',
  balance: 'Balance',
  status: 'Status',
};

function accountCellValue(account, column) {
  switch (column) {
    case 'type':
      return account.type;
    case 'number':
      return account.number;
    case 'balance':
      return account.balance;
    case 'status':
      return account.status || '';
    default: {
      const _exhaustive = column;
      void _exhaustive;
      return '';
    }
  }
}

function buildAccountsHtml(member) {
  const columns = tenant.accountColumns;
  let html =
    '<table class="ns-data" border="1" cellpadding="3" cellspacing="0">' +
    '<tr class="ns-header" bgcolor="#003366">';

  for (const column of columns) {
    const header = ACCOUNT_COLUMN_HEADERS[column] || column;
    html +=
      `<td><font color="#FFFFFF" size="2"><b>${escapeHtml(header)}</b></font></td>`;
  }
  html += '</tr>';

  for (const account of member.accounts) {
    html += '<tr>';
    for (const column of columns) {
      const value = accountCellValue(account, column);
      const align = column === 'balance' ? ' align="right"' : '';
      html += `<td${align}><font size="2">${escapeHtml(value)}</font></td>`;
    }
    html += '</tr>';
  }

  html += '</table>';
  return html;
}

const ACCOUNT_TYPES = ['Savings', 'Money Market', 'Holiday Club'];

function parseDepositAmount(raw) {
  const cleaned = String(raw || '')
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .trim();
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function formatDeposit(amount) {
  return amount.toFixed(2);
}

function isValidNickname(nickname) {
  if (!nickname || !String(nickname).trim()) return false;
  return /^[A-Za-z0-9 ]+$/.test(String(nickname).trim());
}

function buildSelectOptions(values, selected) {
  return values
    .map((value) => {
      const sel = value === selected ? ' selected' : '';
      return `<option value="${escapeHtml(value)}"${sel}>${escapeHtml(value)}</option>`;
    })
    .join('');
}

function buildFundingOptions(member, selected) {
  return member.accounts
    .map((account) => {
      const label = `${account.type} ${account.number} ($${account.balance})`;
      const value = account.number;
      const sel = value === selected ? ' selected' : '';
      return `<option value="${escapeHtml(value)}"${sel}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function renderSubAcctForm(member, values, errorMessage) {
  const selectedType = values.accountType || ACCOUNT_TYPES[0];
  const selectedFunding =
    values.fundingSource || (member.accounts[0] && member.accounts[0].number) || '';
  const statement = values.statementDelivery || 'Mail';

  return renderPage('subacct-new.html', {
    memberId: member.id,
    memberName: member.name,
    nickname: values.nickname || '',
    initialDeposit: values.initialDeposit || '',
    errorHtml: errorMessage ? fieldErrorHtml(errorMessage) : '',
    accountTypeOptions: buildSelectOptions(ACCOUNT_TYPES, selectedType),
    fundingOptions: buildFundingOptions(member, selectedFunding),
    statementMailChecked: statement === 'Mail' ? 'checked' : '',
    statementElectronicChecked: statement === 'Electronic' ? 'checked' : '',
  });
}

/**
 * Deterministic account number from request fields.
 * Same inputs always produce the same number across process restarts.
 */
function generateAccountNumber(pending) {
  const typeCode = {
    Savings: 'SV',
    'Money Market': 'MM',
    'Holiday Club': 'HC',
  }[pending.accountType] || 'XX';
  const nick = pending.nickname
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 4)
    .padEnd(4, 'X');
  const dep = String(Math.round(pending.depositAmount * 100)).padStart(6, '0');
  return `${pending.memberId}${typeCode}${nick}${dep}`;
}

function completeSubAccount(session) {
  const pending = session.pendingSubAcct;
  if (!pending) return null;
  const accountNumber = generateAccountNumber(pending);
  const record = {
    accountNumber: accountNumber,
    memberId: pending.memberId,
    accountType: pending.accountType,
    nickname: pending.nickname,
    initialDeposit: pending.initialDeposit,
    depositAmount: pending.depositAmount,
    fundingSource: pending.fundingSource,
    statementDelivery: pending.statementDelivery,
  };
  subAccountRequests.push(record);
  session.pendingSubAcct = null;
  return record;
}

function renderReview(pending) {
  return renderPage('subacct-review.html', {
    memberId: pending.memberId,
    accountType: pending.accountType,
    nickname: pending.nickname,
    initialDeposit: pending.initialDeposit,
    fundingSource: pending.fundingSource,
    statementDelivery: pending.statementDelivery,
  });
}

function renderApprove(pending, errorMessage) {
  return renderPage('subacct-approve.html', {
    memberId: pending.memberId,
    accountType: pending.accountType,
    nickname: pending.nickname,
    initialDeposit: pending.initialDeposit,
    errorHtml: errorMessage ? fieldErrorHtml(errorMessage) : '',
  });
}

function renderConfirm(record) {
  return renderPage('subacct-confirm.html', {
    memberId: record.memberId,
    accountType: record.accountType,
    nickname: record.nickname,
    initialDeposit: record.initialDeposit,
    accountNumber: record.accountNumber,
  });
}

// ---------------------------------------------------------------------------
// Template renderer
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function elementId(shortName) {
  return tenant.idPrefix + shortName;
}

function elementName(shortName) {
  return tenant.namePrefix + shortName;
}

/**
 * Replace placeholders in an HTML template string.
 *
 * Supported tokens:
 *   {{key}}              — value from the `vars` object (HTML-escaped)
 *   {{raw:key}}          — value from `vars`, not escaped (trusted HTML only)
 *   {{id:shortName}}     — tenant-prefixed element id
 *   {{name:shortName}}   — tenant-prefixed element name (ASP.NET $ form)
 *   {{label:key}}        — tenant label text
 *   {{tenant.displayName}} etc. — dotted path into the tenant object
 *   {{primarySubmit}}    — id+name attributes for the screen's primary submit
 */
function renderString(template, vars) {
  const context = vars || {};

  return template.replace(/\{\{([^}]+)\}\}/g, (match, rawExpr) => {
    const expr = rawExpr.trim();

    if (expr === 'primarySubmit') {
      const id = elementId('btnPrimary');
      const name = elementName('btnPrimary');
      return `id="${escapeHtml(id)}" name="${escapeHtml(name)}"`;
    }

    if (expr.startsWith('id:')) {
      return escapeHtml(elementId(expr.slice(3)));
    }

    if (expr.startsWith('name:')) {
      return escapeHtml(elementName(expr.slice(5)));
    }

    if (expr.startsWith('label:')) {
      const key = expr.slice(6);
      const value = tenant.labels[key];
      if (value === undefined) {
        throw new Error(`Unknown label key "${key}" for tenant "${tenant.key}"`);
      }
      return escapeHtml(value);
    }

    if (expr.startsWith('raw:')) {
      const key = expr.slice(4);
      if (!(key in context)) {
        throw new Error(`Missing template variable "${key}"`);
      }
      return String(context[key]);
    }

    if (expr.startsWith('tenant.')) {
      const parts = expr.slice(7).split('.');
      let value = tenant;
      for (const part of parts) {
        if (value == null || typeof value !== 'object' || !(part in value)) {
          throw new Error(`Unknown tenant path "${expr}"`);
        }
        value = value[part];
      }
      return escapeHtml(value);
    }

    if (!(expr in context)) {
      throw new Error(`Missing template variable "${expr}"`);
    }
    return escapeHtml(context[expr]);
  });
}

function renderPage(pageFile, vars) {
  const filePath = path.join(PAGES_DIR, pageFile);
  const template = fs.readFileSync(filePath, 'utf8');
  return renderString(template, vars);
}

// ---------------------------------------------------------------------------
// Session store (in-memory)
// ---------------------------------------------------------------------------

const sessions = new Map();

function createSession() {
  const id = crypto.randomBytes(16).toString('hex');
  sessions.set(id, {
    createdAt: Date.now(),
    userId: DEMO_USER,
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
  if (clock - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return session;
}

function destroySession(id) {
  if (id) sessions.delete(id);
}

// ---------------------------------------------------------------------------
// Cookies / body / HTTP helpers
// ---------------------------------------------------------------------------

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
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

function sessionCookieHeader(sessionId) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Max-Age=${maxAge}`;
}

function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`;
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

function stripPrimarySubmit(html) {
  const id = elementId('btnPrimary');
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(
    new RegExp(`<input\\b[^>]*\\bid=["']${escaped}["'][^>]*>`, 'gi'),
    ''
  );
}

const FAULT_KINDS = [
  'slow_load',
  'interstitial',
  'session_expired',
  'server_error',
  'element_missing',
];

function armFault(kind) {
  if (!FAULT_KINDS.includes(kind)) {
    return false;
  }
  armedFault = kind;
  return true;
}

function sendServerError(res) {
  sendHtml(res, renderPage('error-500.html', {}), 500);
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
  // Plain red font inside the form table — no role=alert, no semantic hint.
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

function renderLogin(vars) {
  return renderPage('login.html', {
    username: '',
    errorHtml: '',
    ...vars,
  });
}

function renderMemberSearch(vars) {
  return renderPage('member-search.html', {
    memberId: '',
    errorHtml: '',
    ...vars,
  });
}

/**
 * Build the results panel HTML for a member lookup.
 * Business outcomes (not found / denied / found) all return HTTP 200.
 */
function buildResultsHtml(memberId) {
  const member = findMember(memberId);

  if (!member) {
    return (
      '<table class="ns-data" border="1" cellpadding="3" cellspacing="0">' +
      '<tr class="ns-header" bgcolor="#003366">' +
      '<td><font color="#FFFFFF" size="2"><b>Member ID</b></font></td>' +
      '<td><font color="#FFFFFF" size="2"><b>Name</b></font></td>' +
      '<td><font color="#FFFFFF" size="2"><b>Status</b></font></td>' +
      '</tr>' +
      '</table>' +
      '<br><font size="2">No records found.</font>'
    );
  }

  if (member.restricted) {
    return (
      '<font size="2">You are not authorized to view this record.</font>'
    );
  }

  return (
    '<table class="ns-data" border="1" cellpadding="3" cellspacing="0">' +
    '<tr class="ns-header" bgcolor="#003366">' +
    '<td><font color="#FFFFFF" size="2"><b>Member ID</b></font></td>' +
    '<td><font color="#FFFFFF" size="2"><b>Name</b></font></td>' +
    '<td><font color="#FFFFFF" size="2"><b>Status</b></font></td>' +
    '</tr>' +
    '<tr>' +
    `<td><font size="2">${escapeHtml(member.id)}</font></td>` +
    '<td><font size="2">' +
    `<a href="/member/detail?memberId=${encodeURIComponent(member.id)}">` +
    `${escapeHtml(member.name)}</a></font></td>` +
    `<td><font size="2">${escapeHtml(member.status)}</font></td>` +
    '</tr>' +
    '</table>'
  );
}

// ---------------------------------------------------------------------------
// Static files (only from public/)
// ---------------------------------------------------------------------------

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

  const resolved = path.resolve(PUBLIC_DIR, relative);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes = {
  'GET /ping': function (_req, res) {
    sendText(res, 'pong');
  },

  'GET /_example': function (_req, res) {
    const html = renderPage('_example.html', {});
    sendHtml(res, html);
  },

  'GET /login': function (_req, res) {
    sendHtml(res, renderLogin({}));
  },

  'POST /login': async function (req, res) {
    let body;
    try {
      body = await readBody(req);
    } catch (_err) {
      sendText(res, 'Bad Request', 400);
      return;
    }

    const form = parseForm(body);
    const userId = form[elementName('txtUserId')] || '';
    const password = form[elementName('txtPassword')] || '';

    if (userId === DEMO_USER && password === DEMO_PASSWORD) {
      const sessionId = createSession();
      redirect(res, '/', {
        'Set-Cookie': sessionCookieHeader(sessionId),
      });
      return;
    }

    sendHtml(
      res,
      renderLogin({
        username: userId,
        errorHtml: loginErrorHtml('Invalid User ID or Password.'),
      })
    );
  },

  'GET /': function (_req, res) {
    sendHtml(res, renderPage('shell.html', {}));
  },

  'GET /welcome': function (_req, res) {
    sendHtml(res, renderPage('welcome.html', {}));
  },

  'GET /member/search': function (_req, res) {
    sendHtml(res, renderMemberSearch({}));
  },

  'POST /member/search': async function (req, res) {
    let body;
    try {
      body = await readBody(req);
    } catch (_err) {
      sendText(res, 'Bad Request', 400);
      return;
    }

    const form = parseForm(body);
    const memberId = (form[elementName('txtMemberId')] || '').trim();

    if (!/^\d+$/.test(memberId)) {
      sendHtml(
        res,
        renderMemberSearch({
          memberId: memberId,
          errorHtml: fieldErrorHtml('Member number must be numeric.'),
        })
      );
      return;
    }

    // Full document navigation inside the iframe (no XHR).
    redirect(res, '/member/results?memberId=' + encodeURIComponent(memberId));
  },

  'GET /member/results': function (req, res) {
    const memberId = queryParam(req, 'memberId');

    sendHtml(
      res,
      renderPage('member-results.html', {
        resultsHtml: buildResultsHtml(memberId),
      })
    );
  },

  'GET /member/detail': function (req, res) {
    const memberId = queryParam(req, 'memberId');
    const member = findMember(memberId);

    if (!member || member.restricted) {
      sendHtml(
        res,
        renderPage('member-results.html', {
          resultsHtml: buildResultsHtml(memberId),
        })
      );
      return;
    }

    sendHtml(
      res,
      renderPage('member-detail.html', {
        memberId: member.id,
        memberName: member.name,
        memberStatus: member.status,
        openedOn: member.openedOn,
        accountsHtml: buildAccountsHtml(member),
      })
    );
  },

  'GET /member/danger/close': function (req, res) {
    const memberId = queryParam(req, 'memberId');
    sendHtml(
      res,
      renderPage('member-danger.html', {
        pageTitle: 'Close Account',
        memberId: memberId,
        message:
          'Account closure has been submitted for member ' +
          memberId +
          '. This action is irreversible. (Demo only - no accounts were changed.)',
      })
    );
  },

  'GET /member/danger/adjust': function (req, res) {
    const memberId = queryParam(req, 'memberId');
    sendHtml(
      res,
      renderPage('member-danger.html', {
        pageTitle: 'Post Adjustment',
        memberId: memberId,
        message:
          'Manual balance adjustment has been posted for member ' +
          memberId +
          '. This action is irreversible. (Demo only - no balances were changed.)',
      })
    );
  },

  'GET /member/subacct/new': function (req, res) {
    const memberId = queryParam(req, 'memberId');
    const member = findMember(memberId);
    if (!member || member.restricted) {
      redirect(res, '/member/search');
      return;
    }
    sendHtml(res, renderSubAcctForm(member, {}, null));
  },

  'POST /member/subacct/new': async function (req, res) {
    let body;
    try {
      body = await readBody(req);
    } catch (_err) {
      sendText(res, 'Bad Request', 400);
      return;
    }

    const form = parseForm(body);
    const memberId = (form.memberId || '').trim();
    const member = findMember(memberId);
    if (!member || member.restricted) {
      redirect(res, '/member/search');
      return;
    }

    const values = {
      accountType: form[elementName('ddlAccountType')] || '',
      nickname: form[elementName('txtNickname')] || '',
      initialDeposit: form[elementName('txtInitialDeposit')] || '',
      fundingSource: form[elementName('ddlFundingSource')] || '',
      statementDelivery: form[elementName('rdoStatement')] || '',
    };

    if (!ACCOUNT_TYPES.includes(values.accountType)) {
      sendHtml(
        res,
        renderSubAcctForm(member, values, 'Please select a valid account type.')
      );
      return;
    }

    if (!isValidNickname(values.nickname)) {
      sendHtml(
        res,
        renderSubAcctForm(
          member,
          values,
          'Nickname is required and may not contain special characters.'
        )
      );
      return;
    }

    const amount = parseDepositAmount(values.initialDeposit);
    if (amount === null) {
      sendHtml(
        res,
        renderSubAcctForm(member, values, 'Initial deposit must be a valid amount.')
      );
      return;
    }
    if (amount < 25) {
      sendHtml(
        res,
        renderSubAcctForm(
          member,
          values,
          'Initial deposit must be at least $25.00'
        )
      );
      return;
    }

    const fundingOk = member.accounts.some(
      (account) => account.number === values.fundingSource
    );
    if (!fundingOk) {
      sendHtml(
        res,
        renderSubAcctForm(member, values, 'Please select a funding source.')
      );
      return;
    }

    if (values.statementDelivery !== 'Mail' && values.statementDelivery !== 'Electronic') {
      sendHtml(
        res,
        renderSubAcctForm(member, values, 'Please select statement delivery.')
      );
      return;
    }

    req.session.pendingSubAcct = {
      memberId: member.id,
      accountType: values.accountType,
      nickname: values.nickname.trim(),
      initialDeposit: formatDeposit(amount),
      depositAmount: amount,
      fundingSource: values.fundingSource,
      statementDelivery: values.statementDelivery,
    };

    redirect(res, '/member/subacct/review');
  },

  'GET /member/subacct/review': function (req, res) {
    const pending = req.session && req.session.pendingSubAcct;
    if (!pending) {
      redirect(res, '/member/search');
      return;
    }
    sendHtml(res, renderReview(pending));
  },

  'POST /member/subacct/confirm': function (req, res) {
    const pending = req.session && req.session.pendingSubAcct;
    if (!pending) {
      redirect(res, '/member/search');
      return;
    }

    if (pending.depositAmount >= SUPERVISOR_THRESHOLD) {
      redirect(res, '/member/subacct/approve');
      return;
    }

    const record = completeSubAccount(req.session);
    sendHtml(res, renderConfirm(record));
  },

  'GET /member/subacct/approve': function (req, res) {
    const pending = req.session && req.session.pendingSubAcct;
    if (!pending) {
      redirect(res, '/member/search');
      return;
    }
    if (pending.depositAmount < SUPERVISOR_THRESHOLD) {
      redirect(res, '/member/subacct/review');
      return;
    }
    sendHtml(res, renderApprove(pending, null));
  },

  'POST /member/subacct/approve': async function (req, res) {
    const pending = req.session && req.session.pendingSubAcct;
    if (!pending) {
      redirect(res, '/member/search');
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch (_err) {
      sendText(res, 'Bad Request', 400);
      return;
    }

    const form = parseForm(body);
    const code = (form[elementName('txtApprovalCode')] || '').trim();

    if (code !== SUPERVISOR_CODE) {
      sendHtml(res, renderApprove(pending, 'Invalid approval code.'));
      return;
    }

    const record = completeSubAccount(req.session);
    sendHtml(res, renderConfirm(record));
  },

  'GET /logout': function (req, res) {
    const cookies = parseCookies(req.headers.cookie);
    destroySession(cookies[SESSION_COOKIE]);
    redirect(res, '/login', {
      'Set-Cookie': clearSessionCookieHeader(),
    });
  },

  // Scenario control panel — not part of the app under automation.
  'POST /_fault': async function (req, res) {
    let body;
    try {
      body = await readBody(req);
    } catch (_err) {
      sendText(res, 'Bad Request', 400);
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch (_err) {
      sendText(res, 'Invalid JSON', 400);
      return;
    }

    const kind = payload && payload.kind;
    if (!armFault(kind)) {
      sendText(res, 'Unknown fault kind', 400);
      return;
    }

    sendText(res, `armed:${kind}`);
  },
};

function isPublicPath(method, pathname) {
  if (pathname === '/public' || pathname.startsWith('/public/')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/login' && (method === 'GET' || method === 'POST')) return true;
  if (method === 'POST' && pathname === '/_fault') return true;
  // Stage 0 diagnostics stay reachable without a session.
  if (method === 'GET' && (pathname === '/ping' || pathname === '/_example')) return true;
  return false;
}

function isFaultExempt(pathname) {
  return (
    pathname === '/_fault' ||
    pathname === '/public' ||
    pathname.startsWith('/public/') ||
    pathname === '/favicon.ico'
  );
}

function dispatch(req, res, pathname) {
  if (!isPublicPath(req.method, pathname)) {
    const cookies = parseCookies(req.headers.cookie);
    const session = getSession(cookies[SESSION_COOKIE]);
    if (!session) {
      redirect(res, '/login');
      return;
    }
    req.session = session;
  }

  const key = `${req.method} ${pathname}`;
  const handler = routes[key];
  if (handler) {
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error(err);
      sendText(res, 'Internal Server Error', 500);
    });
    return;
  }

  notFound(res);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
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

  if (!isFaultExempt(pathname) && armedFault) {
    const kind = armedFault;

    if (kind === 'session_expired') {
      armedFault = null;
      const cookies = parseCookies(req.headers.cookie);
      destroySession(cookies[SESSION_COOKIE]);
      redirect(res, '/login', {
        'Set-Cookie': clearSessionCookieHeader(),
      });
      return;
    }

    if (kind === 'server_error') {
      armedFault = null;
      sendServerError(res);
      return;
    }

    if (kind === 'interstitial') {
      armedFault = null;
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
      armedFault = null;
      setTimeout(() => {
        dispatch(req, res, pathname);
      }, 8000);
      return;
    }

    if (kind === 'element_missing') {
      armedFault = null;
      res.__stripPrimary = true;
      dispatch(req, res, pathname);
      return;
    }
  }

  dispatch(req, res, pathname);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Legacy Console listening on http://localhost:${PORT}`);
    console.log(`Tenant: ${tenant.key} (${tenant.displayName})`);
    console.log(`Members loaded: ${membersById.size}`);
    console.log(`Session TTL: ${SESSION_TTL_MIN} min`);
    console.log(`Sign on: http://localhost:${PORT}/login`);
  });
}

// Exported for the Stage 1.2 manual session check (node -e require...).
module.exports = {
  createSession,
  getSession,
  destroySession,
  SESSION_TTL_MS,
  sessions,
  generateAccountNumber,
};
