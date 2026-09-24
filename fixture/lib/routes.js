'use strict';

const config = require('./config');
const { findMember } = require('./members');
const sessionStore = require('./session');
const { elementName, renderPage } = require('./template');
const {
  parseCookies,
  readBody,
  parseForm,
  queryParam,
  sendHtml,
  sendText,
  redirect,
  notFound,
  sessionCookieHeader,
  clearSessionCookieHeader,
} = require('./http');
const { armFault } = require('./faults');
const memberViews = require('./views/member');
const subacctViews = require('./views/subacct');

function createRoutes() {
  return {
    'GET /ping': function (_req, res) {
      sendText(res, 'pong');
    },

    'GET /login': function (_req, res) {
      sendHtml(res, memberViews.renderLogin({}));
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

      if (userId === config.DEMO_USER && password === config.DEMO_PASSWORD) {
        const sessionId = sessionStore.createSession();
        redirect(res, '/', {
          'Set-Cookie': sessionCookieHeader(sessionId),
        });
        return;
      }

      sendHtml(
        res,
        memberViews.renderLogin({
          username: userId,
          errorHtml: memberViews.loginErrorHtml('Invalid User ID or Password.'),
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
      sendHtml(res, memberViews.renderMemberSearch({}));
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
          memberViews.renderMemberSearch({
            memberId: memberId,
            errorHtml: memberViews.fieldErrorHtml('Member number must be numeric.'),
          })
        );
        return;
      }

      redirect(res, '/member/results?memberId=' + encodeURIComponent(memberId));
    },

    'GET /member/results': function (req, res) {
      const memberId = queryParam(req, 'memberId');

      sendHtml(
        res,
        renderPage('member-results.html', {
          resultsHtml: memberViews.buildResultsHtml(memberId),
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
            resultsHtml: memberViews.buildResultsHtml(memberId),
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
          accountsHtml: memberViews.buildAccountsHtml(member),
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
      sendHtml(res, subacctViews.renderSubAcctForm(member, {}, null));
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

      const values = subacctViews.parseSubAcctForm(form);
      const error = subacctViews.validateSubAcctForm(member, values);
      if (error) {
        sendHtml(res, subacctViews.renderSubAcctForm(member, values, error));
        return;
      }

      const amount = subacctViews.parseDepositAmount(values.initialDeposit);
      req.session.pendingSubAcct = subacctViews.buildPendingSubAcct(
        member,
        values,
        amount
      );

      redirect(res, '/member/subacct/review');
    },

    'GET /member/subacct/review': function (req, res) {
      const pending = req.session && req.session.pendingSubAcct;
      if (!pending) {
        redirect(res, '/member/search');
        return;
      }
      sendHtml(res, subacctViews.renderReview(pending));
    },

    'POST /member/subacct/confirm': function (req, res) {
      const pending = req.session && req.session.pendingSubAcct;
      if (!pending) {
        redirect(res, '/member/search');
        return;
      }

      if (pending.depositAmount >= config.SUPERVISOR_THRESHOLD) {
        redirect(res, '/member/subacct/approve');
        return;
      }

      const record = subacctViews.completeSubAccount(req.session);
      sendHtml(res, subacctViews.renderConfirm(record));
    },

    'GET /member/subacct/approve': function (req, res) {
      const pending = req.session && req.session.pendingSubAcct;
      if (!pending) {
        redirect(res, '/member/search');
        return;
      }
      if (pending.depositAmount < config.SUPERVISOR_THRESHOLD) {
        redirect(res, '/member/subacct/review');
        return;
      }
      sendHtml(res, subacctViews.renderApprove(pending, null));
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

      if (code !== config.SUPERVISOR_CODE) {
        sendHtml(res, subacctViews.renderApprove(pending, 'Invalid approval code.'));
        return;
      }

      const record = subacctViews.completeSubAccount(req.session);
      sendHtml(res, subacctViews.renderConfirm(record));
    },

    'GET /logout': function (req, res) {
      const cookies = parseCookies(req.headers.cookie);
      sessionStore.destroySession(cookies[config.SESSION_COOKIE]);
      redirect(res, '/login', {
        'Set-Cookie': clearSessionCookieHeader(),
      });
    },

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
}

function isPublicPath(method, pathname) {
  if (pathname === '/public' || pathname.startsWith('/public/')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/login' && (method === 'GET' || method === 'POST')) return true;
  if (method === 'POST' && pathname === '/_fault') return true;
  if (method === 'GET' && pathname === '/ping') return true;
  return false;
}

function createDispatch(routes) {
  return function dispatch(req, res, pathname) {
    if (!isPublicPath(req.method, pathname)) {
      const cookies = parseCookies(req.headers.cookie);
      const session = sessionStore.getSession(cookies[config.SESSION_COOKIE]);
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
  };
}

module.exports = {
  createRoutes,
  createDispatch,
  isPublicPath,
};
