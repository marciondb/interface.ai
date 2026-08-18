'use strict';

const { findMember } = require('../members');
const { tenant, escapeHtml, renderPage } = require('../template');
const { fieldErrorHtml, loginErrorHtml } = require('../http');

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
    return '<font size="2">You are not authorized to view this record.</font>';
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

module.exports = {
  loginErrorHtml,
  fieldErrorHtml,
  buildAccountsHtml,
  renderLogin,
  renderMemberSearch,
  buildResultsHtml,
};
