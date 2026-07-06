const { app } = require('@azure/functions');
const store = require('../lib/store');
const { isModerator } = require('../lib/auth');

const json = (status, body) => ({
  status,
  jsonBody: body,
  headers: { 'Cache-Control': 'no-store' },
});

// Route must not start with "admin" — the Functions host reserves admin*
// for its built-in administration API and silently refuses to register
// the endpoint ("route conflicts with one or more built in routes").
app.http('moderation', {
  route: 'moderation',
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // SWA route rules gate this to the moderator role
  handler: async (request, context) => {
    try {
      if (!isModerator(request)) return json(403, { error: 'forbidden' });

      if (request.method === 'GET') {
        const [pending, approved] = await Promise.all([
          store.listPending(),
          store.listApprovedAll(),
        ]);
        return json(200, { pending, approved });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: 'invalid JSON' });
      }

      const { action, pk, id } = body;
      if (!pk || !id) return json(400, { error: 'pk and id are required' });

      if (action === 'approve') {
        await store.approveComment(pk, id);
        return json(200, { ok: true });
      }
      if (action === 'delete') {
        await store.deleteComment(pk, id);
        return json(200, { ok: true });
      }
      return json(400, { error: 'unknown action' });
    } catch (e) {
      context.error('moderation handler failed:', e);
      return json(500, { error: 'internal error' });
    }
  },
});
