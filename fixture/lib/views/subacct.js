'use strict';

const { escapeHtml, elementName, renderPage } = require('../template');
const { fieldErrorHtml } = require('../http');

const ACCOUNT_TYPES = ['Savings', 'Money Market', 'Holiday Club'];

/** @type {object[]} */
const subAccountRequests = [];

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

function validateSubAcctForm(member, values) {
  if (!ACCOUNT_TYPES.includes(values.accountType)) {
    return 'Please select a valid account type.';
  }
  if (!isValidNickname(values.nickname)) {
    return 'Nickname is required and may not contain special characters.';
  }
  const amount = parseDepositAmount(values.initialDeposit);
  if (amount === null) {
    return 'Initial deposit must be a valid amount.';
  }
  if (amount < 25) {
    return 'Initial deposit must be at least $25.00';
  }
  const fundingOk = member.accounts.some(
    (account) => account.number === values.fundingSource
  );
  if (!fundingOk) {
    return 'Please select a funding source.';
  }
  if (values.statementDelivery !== 'Mail' && values.statementDelivery !== 'Electronic') {
    return 'Please select statement delivery.';
  }
  return null;
}

function buildPendingSubAcct(member, values, amount) {
  return {
    memberId: member.id,
    accountType: values.accountType,
    nickname: values.nickname.trim(),
    initialDeposit: formatDeposit(amount),
    depositAmount: amount,
    fundingSource: values.fundingSource,
    statementDelivery: values.statementDelivery,
  };
}

function parseSubAcctForm(form) {
  return {
    accountType: form[elementName('ddlAccountType')] || '',
    nickname: form[elementName('txtNickname')] || '',
    initialDeposit: form[elementName('txtInitialDeposit')] || '',
    fundingSource: form[elementName('ddlFundingSource')] || '',
    statementDelivery: form[elementName('rdoStatement')] || '',
  };
}

module.exports = {
  ACCOUNT_TYPES,
  subAccountRequests,
  parseDepositAmount,
  renderSubAcctForm,
  generateAccountNumber,
  completeSubAccount,
  renderReview,
  renderApprove,
  renderConfirm,
  validateSubAcctForm,
  buildPendingSubAcct,
  parseSubAcctForm,
};
