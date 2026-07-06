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
};
