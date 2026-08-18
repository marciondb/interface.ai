'use strict';

/**
 * Tenant configuration.
 *
 * Only "banktest" is built. A second tenant is a matter of adding another
 * object here — screens already read these values through the template helpers.
 */

const tenants = {
  banktest: {
    key: 'banktest',
    displayName: 'Bank Test',
    // ASP.NET WebForms-style generated id / name prefixes.
    idPrefix: 'ctl00_ContentPlaceHolder1_',
    namePrefix: 'ctl00$ContentPlaceHolder1$',
    labels: {
      memberId: 'Member ID',
    },
    // Column order for the accounts table on the member detail screen.
    accountColumns: ['type', 'number', 'balance'],
    // Base path for member routes (Tenant B would use /members).
    routeBase: '/member',
  },
};

function getTenant() {
  const key = process.env.TENANT || 'banktest';
  const tenant = tenants[key];
  if (!tenant) {
    const known = Object.keys(tenants).join(', ');
    throw new Error(`Unknown TENANT="${key}". Known: ${known}`);
  }
  return tenant;
}

module.exports = { getTenant, tenants };
