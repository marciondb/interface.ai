'use strict';

/**
 * Primary submit convention (Stage 0.6):
 * Every screen's primary submit control MUST include {{primarySubmit}}.
 * Stage 9's element_missing fault removes the control with id btnPrimary.
 * Do not use aria-*, role=, or data-testid for this marker.
 */

const fs = require('fs');
const path = require('path');
const { getTenant } = require('../tenants');
const config = require('./config');

const tenant = getTenant();

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
  const filePath = path.join(config.PAGES_DIR, pageFile);
  const template = fs.readFileSync(filePath, 'utf8');
  return renderString(template, vars);
}

function stripPrimarySubmit(html) {
  const id = elementId('btnPrimary');
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(
    new RegExp(`<input\\b[^>]*\\bid=["']${escaped}["'][^>]*>`, 'gi'),
    ''
  );
}

module.exports = {
  tenant,
  escapeHtml,
  elementId,
  elementName,
  renderPage,
  stripPrimarySubmit,
};
