'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

/** @type {Map<string, object>} */
const membersById = loadMembers();

function loadMembers() {
  const filePath = path.join(config.DATA_DIR, 'members.json');
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

module.exports = {
  membersById,
  findMember,
};
