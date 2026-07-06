const { app } = require('@azure/functions');
const store = require('../lib/store');
const { isValidPageId, isValidTargetId, parseEmojiList } = require('../lib/validate');

const DEFAULT_EMOJIS = ['\u{1F44D}', '❤️', '\u{1F4A1}']; // 👍 ❤️ 💡
const EMOJIS = parseEmojiList(process.env.REACTION_EMOJIS, DEFAULT_EMOJIS);
const MAX_REACTIONS_PER_TARGET =
  Number(process.env.MAX_REACTIONS_PER_TARGET) || 500;

const json = (status, body) => ({
  status,
  jsonBody: body,
  headers: { 'Cache-Control': 'no-store' },
});

app.http('reactions', {
  route: 'reactions',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: 'invalid JSON' });
      }

      const pageId = body.pageId;
      if (!isValidPageId(pageId)) return json(400, { error: 'invalid pageId' });

      // Un-react: delete by receipt. Idempotent — removing twice is fine,
      // so a retried request never surfaces an error to the reader.
      if (body.remove) {
        await store.removeReaction(pageId, body.receipt);
        return json(200, { ok: true });
      }

      const { targetId, emoji } = body;
      if (!EMOJIS.includes(emoji)) return json(400, { error: 'unknown reaction' });
      if (!isValidTargetId(targetId)) return json(400, { error: 'invalid target' });
      if (targetId !== '_post' && !(await store.commentApprovedExists(pageId, targetId))) {
        return json(404, { error: 'comment not found' });
      }
      if ((await store.countReactionsFor(pageId, targetId)) >= MAX_REACTIONS_PER_TARGET) {
        return json(429, { error: 'reaction limit reached' });
      }

      const receipt = await store.addReaction({ pageId, targetId, emoji });
      return json(201, { receipt });
    } catch (e) {
      context.error('reactions handler failed:', e);
      return json(500, { error: 'internal error' });
    }
  },
});
