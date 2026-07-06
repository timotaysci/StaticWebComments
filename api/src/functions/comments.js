const { app } = require('@azure/functions');
const store = require('../lib/store');
const { cleanText } = require('../lib/validate');

const MAX_NICKNAME = Number(process.env.MAX_NICKNAME_LENGTH) || 50;
const MAX_CONTENT = Number(process.env.MAX_CONTENT_LENGTH) || 4000;
const MAX_PENDING_PER_PAGE = Number(process.env.MAX_PENDING_PER_PAGE) || 25;

// Which page paths may receive comments. Tighten this to your content
// paths (e.g. '^/blog/[a-z0-9-]+/$') so bots can't create junk partitions.
const PAGE_ID_PATTERN = new RegExp(
  process.env.PAGE_ID_PATTERN || '^/[a-zA-Z0-9/_-]{1,200}$'
);

const json = (status, body) => ({
  status,
  jsonBody: body,
  headers: { 'Cache-Control': 'no-store' },
});

function isValidPageId(pageId) {
  return typeof pageId === 'string' && PAGE_ID_PATTERN.test(pageId);
}

app.http('comments', {
  route: 'comments',
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      if (request.method === 'GET') {
        const pageId = request.query.get('pageId') || '';
        if (!isValidPageId(pageId)) return json(400, { error: 'invalid pageId' });
        return json(200, { comments: await store.listApproved(pageId) });
      }

      // POST — submit a comment
      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: 'invalid JSON' });
      }

      // Honeypot: real users never see this field. Pretend success so
      // bots don't learn they were caught.
      if (body.website) {
        context.log('honeypot tripped, dropping comment');
        return json(200, { ok: true });
      }

      const pageId = body.pageId;
      const nickname = cleanText(body.nickname, MAX_NICKNAME);
      const content = cleanText(body.content, MAX_CONTENT);
      const pageTitle = cleanText(body.pageTitle, 200);

      if (!isValidPageId(pageId)) return json(400, { error: 'invalid pageId' });
      if (!nickname) return json(400, { error: 'name is required' });
      if (!content) return json(400, { error: 'comment is required' });

      // Flood guard: a page with this many unmoderated comments is
      // being botted; stop accepting until they are reviewed.
      if ((await store.countPending(pageId)) >= MAX_PENDING_PER_PAGE) {
        return json(429, { error: 'too many pending comments on this page' });
      }

      await store.addComment({ pageId, pageTitle, nickname, content });

      // Optional push notification via ntfy.sh — enabled by setting the
      // NTFY_TOPIC app setting. Failures never affect the response.
      if (process.env.NTFY_TOPIC) {
        try {
          const headers = {
            Title: `New comment on ${pageTitle || pageId}`,
            Tags: 'speech_balloon',
          };
          if (process.env.ADMIN_URL) headers.Click = process.env.ADMIN_URL;
          await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
            method: 'POST',
            headers,
            body: `${nickname}: ${content.slice(0, 200)}`,
          });
        } catch (e) {
          context.log('ntfy notification failed:', e.message);
        }
      }

      return json(201, { ok: true });
    } catch (e) {
      context.error('comments handler failed:', e);
      return json(500, { error: 'internal error' });
    }
  },
});
