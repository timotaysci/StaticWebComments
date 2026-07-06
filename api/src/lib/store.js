const { TableClient } = require('@azure/data-tables');
const crypto = require('crypto');

const TABLE = process.env.COMMENTS_TABLE || 'comments';

function getClient() {
  const conn = process.env.TABLES_CONNECTION;
  if (!conn) throw new Error('TABLES_CONNECTION app setting is not configured');
  return TableClient.fromConnectionString(conn, TABLE);
}

// Table keys forbid / \ # ? — map a page path like /writing/foo/ to a safe key
function pageKey(pageId) {
  return pageId.replace(/[^a-zA-Z0-9-]/g, '_');
}

function newId() {
  return crypto.randomUUID();
}

async function addComment({ pageId, pageTitle, nickname, content }) {
  const client = getClient();
  const entity = {
    partitionKey: pageKey(pageId),
    rowKey: newId(),
    pageId,
    pageTitle: pageTitle || '',
    nickname,
    content,
    createdAt: new Date().toISOString(),
    approved: false,
  };
  await client.createEntity(entity);
  return entity;
}

async function listApproved(pageId) {
  const client = getClient();
  const comments = [];
  const iter = client.listEntities({
    queryOptions: {
      filter: `PartitionKey eq '${pageKey(pageId)}' and approved eq true`,
    },
  });
  for await (const e of iter) {
    comments.push({
      id: e.rowKey,
      nickname: e.nickname,
      content: e.content,
      createdAt: e.createdAt,
    });
  }
  comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return comments;
}

async function countPending(pageId) {
  const client = getClient();
  let n = 0;
  const iter = client.listEntities({
    queryOptions: {
      filter: `PartitionKey eq '${pageKey(pageId)}' and approved eq false`,
      select: ['rowKey'],
    },
  });
  for await (const _ of iter) n++;
  return n;
}

async function listPending() {
  const client = getClient();
  const comments = [];
  const iter = client.listEntities({
    queryOptions: { filter: `approved eq false` },
  });
  for await (const e of iter) {
    comments.push({
      pk: e.partitionKey,
      id: e.rowKey,
      pageId: e.pageId,
      pageTitle: e.pageTitle,
      nickname: e.nickname,
      content: e.content,
      createdAt: e.createdAt,
    });
  }
  comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return comments;
}

// Everything live on the site, newest first — for the moderation page's
// "Published" section so approved comments can still be deleted.
async function listApprovedAll() {
  const client = getClient();
  const comments = [];
  const iter = client.listEntities({
    queryOptions: { filter: `approved eq true` },
  });
  for await (const e of iter) {
    comments.push({
      pk: e.partitionKey,
      id: e.rowKey,
      pageId: e.pageId,
      pageTitle: e.pageTitle,
      nickname: e.nickname,
      content: e.content,
      createdAt: e.createdAt,
    });
  }
  comments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return comments;
}

// --- Reactions ------------------------------------------------------
// One entity per reaction: rowKey `react_<uuid>` in the page's partition.
// Comment rowKeys are plain hex UUIDs (all sort before 'r'), so the prefix
// cleanly separates the two entity kinds and comment queries (which filter
// on `approved`, a property reactions never carry) are unaffected.
const REACTION_PREFIX = 'react_';

async function addReaction({ pageId, targetId, emoji }) {
  const client = getClient();
  const entity = {
    partitionKey: pageKey(pageId),
    rowKey: REACTION_PREFIX + newId(),
    targetId,
    emoji,
    createdAt: new Date().toISOString(),
  };
  await client.createEntity(entity);
  return entity.rowKey;
}

// Idempotent: removing a receipt that is already gone is not an error.
async function removeReaction(pageId, receipt) {
  if (typeof receipt !== 'string' || !receipt.startsWith(REACTION_PREFIX)) {
    return false;
  }
  const client = getClient();
  try {
    await client.deleteEntity(pageKey(pageId), receipt);
    return true;
  } catch (e) {
    if (e.statusCode === 404) return false;
    throw e;
  }
}

// { [targetId]: { [emoji]: count } } for one page ('_post' included)
async function listReactions(pageId) {
  const client = getClient();
  const counts = {};
  const iter = client.listEntities({
    queryOptions: {
      // rowKey range covers exactly the react_ prefix ('`' follows '_')
      filter: `PartitionKey eq '${pageKey(pageId)}' and RowKey ge 'react_' and RowKey lt 'react\`'`,
    },
  });
  for await (const e of iter) {
    if (!counts[e.targetId]) counts[e.targetId] = {};
    counts[e.targetId][e.emoji] = (counts[e.targetId][e.emoji] || 0) + 1;
  }
  return counts;
}

// Callers must validate targetId ('_post' or UUID) before it reaches a filter.
async function countReactionsFor(pageId, targetId) {
  const client = getClient();
  let n = 0;
  const iter = client.listEntities({
    queryOptions: {
      filter: `PartitionKey eq '${pageKey(pageId)}' and targetId eq '${targetId}'`,
      select: ['rowKey'],
    },
  });
  for await (const _ of iter) n++;
  return n;
}

// True only for comments that exist AND are approved — pending comments
// are invisible to readers, so they cannot be reaction targets.
async function commentApprovedExists(pageId, id) {
  const client = getClient();
  try {
    const e = await client.getEntity(pageKey(pageId), id);
    return e.approved === true;
  } catch (e) {
    if (e.statusCode === 404) return false;
    throw e;
  }
}

// Cascade used by moderation delete (pk is already the partition key)
async function deleteReactionsFor(pk, targetId) {
  const client = getClient();
  const keys = [];
  const iter = client.listEntities({
    queryOptions: {
      filter: `PartitionKey eq '${pk}' and targetId eq '${targetId}'`,
      select: ['rowKey'],
    },
  });
  for await (const e of iter) keys.push(e.rowKey);
  for (const rk of keys) await client.deleteEntity(pk, rk);
  return keys.length;
}

async function approveComment(pk, id) {
  const client = getClient();
  await client.updateEntity({ partitionKey: pk, rowKey: id, approved: true }, 'Merge');
}

async function deleteComment(pk, id) {
  const client = getClient();
  await client.deleteEntity(pk, id);
}

module.exports = {
  addComment,
  listApproved,
  countPending,
  listPending,
  listApprovedAll,
  approveComment,
  deleteComment,
  pageKey,
  addReaction,
  removeReaction,
  listReactions,
  countReactionsFor,
  commentApprovedExists,
  deleteReactionsFor,
};
