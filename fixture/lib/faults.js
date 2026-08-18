'use strict';

const FAULT_KINDS = [
  'slow_load',
  'interstitial',
  'session_expired',
  'server_error',
  'element_missing',
];

/** Armed one-shot runtime fault, or null. */
let armedFault = null;

function armFault(kind) {
  if (!FAULT_KINDS.includes(kind)) {
    return false;
  }
  armedFault = kind;
  return true;
}

function getArmedFault() {
  return armedFault;
}

function clearArmedFault() {
  armedFault = null;
}

function isFaultExempt(pathname) {
  return (
    pathname === '/_fault' ||
    pathname === '/public' ||
    pathname.startsWith('/public/') ||
    pathname === '/favicon.ico'
  );
}

module.exports = {
  FAULT_KINDS,
  armFault,
  getArmedFault,
  clearArmedFault,
  isFaultExempt,
};
