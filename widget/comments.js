/**
 * Static Web Comments — drop-in widget.
 *
 * Usage:
 *   <link rel="stylesheet" href="/comments.css" />
 *   <div data-swc-comments></div>
 *   <script src="/comments.js" defer></script>
 *
 * Optional attributes on the container:
 *   data-page-id     unique thread key (default: location.pathname)
 *   data-page-title  shown in notifications (default: document.title)
 *   data-api-base    API prefix (default: /api)
 *   data-reactions   comma-separated emoji set (default: 👍,❤️,💡 —
 *                    must match the API's REACTION_EMOJIS setting);
 *                    set to "off" to disable reactions entirely
 *
 * All user content is rendered with textContent — never innerHTML.
 */
(function () {
  const container = document.querySelector('[data-swc-comments]');
  if (!container) return;

  const pageId = container.getAttribute('data-page-id') || location.pathname;
  const pageTitle = container.getAttribute('data-page-title') || document.title;
  const apiBase = container.getAttribute('data-api-base') || '/api';

  const reactionsAttr = container.getAttribute('data-reactions') || '';
  const reactionsEnabled = reactionsAttr.trim().toLowerCase() !== 'off';
  const EMOJIS = reactionsAttr && reactionsEnabled
    ? reactionsAttr.split(',').map((s) => s.trim()).filter(Boolean)
    : ['\u{1F44D}', '❤️', '\u{1F4A1}'];
  const receiptsKey = 'swc-react:' + pageId;

  // --- build DOM -----------------------------------------------------
  const postReactions = document.createElement('div');
  postReactions.className = 'swc-post-reactions';

  const list = document.createElement('div');
  list.className = 'swc-list';
  list.setAttribute('aria-live', 'polite');

  const form = document.createElement('form');
  form.className = 'swc-form';
  form.autocomplete = 'off';
  form.innerHTML = [
    '<label class="swc-field"><span>Name</span>',
    '<input name="nickname" maxlength="50" required /></label>',
    // Honeypot: visually hidden, humans never see it, bots fill it in.
    '<label class="swc-website"><span>Website</span>',
    '<input name="website" tabindex="-1" autocomplete="off" /></label>',
    '<label class="swc-field"><span>Comment</span>',
    '<textarea name="content" rows="4" maxlength="4000" required></textarea></label>',
    '<button type="submit" class="swc-submit">Post comment</button>',
    '<p class="swc-status" role="status"></p>',
  ].join('');

  container.append(postReactions, list, form);
  const statusEl = form.querySelector('.swc-status');
  const submitBtn = form.querySelector('.swc-submit');

  // --- reactions -----------------------------------------------------
  function getReceipts() {
    try {
      return JSON.parse(localStorage.getItem(receiptsKey) || '{}');
    } catch {
      return {};
    }
  }

  function setReceipts(r) {
    localStorage.setItem(receiptsKey, JSON.stringify(r));
  }

  function buildChips(targetId, counts) {
    counts = counts || {};
    const row = document.createElement('div');
    row.className = 'swc-react-row';
    for (const emoji of EMOJIS) {
      const key = targetId + '|' + emoji;
      let count = counts[emoji] || 0;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swc-react-chip';
      btn.setAttribute('aria-label', 'React with ' + emoji);
      const glyph = document.createElement('span');
      glyph.textContent = emoji;
      const num = document.createElement('span');
      num.className = 'swc-react-count';
      btn.append(glyph, num);

      const paint = () => {
        btn.setAttribute('aria-pressed', String(Boolean(getReceipts()[key])));
        num.textContent = String(count);
      };
      paint();

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const r = getReceipts();
        try {
          if (r[key]) {
            // un-react: optimistic, receipt-based, idempotent server-side
            const receipt = r[key];
            delete r[key];
            setReceipts(r);
            count = Math.max(0, count - 1);
            paint();
            await fetch(apiBase + '/reactions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pageId, remove: true, receipt }),
            });
          } else {
            count += 1;
            paint();
            const res = await fetch(apiBase + '/reactions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pageId, targetId, emoji, pageTitle }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.receipt) {
              r[key] = data.receipt;
              setReceipts(r);
            } else {
              count = Math.max(0, count - 1); // revert optimism
            }
            paint();
          }
        } catch {
          paint();
        } finally {
          btn.disabled = false;
        }
      });

      row.appendChild(btn);
    }
    return row;
  }

  // --- render --------------------------------------------------------
  function note(text) {
    list.textContent = '';
    const p = document.createElement('p');
    p.className = 'swc-note';
    p.textContent = text;
    list.appendChild(p);
  }

  function render(comments, reactions) {
    reactions = reactions || {};
    if (reactionsEnabled) {
      postReactions.textContent = '';
      postReactions.appendChild(buildChips('_post', reactions['_post']));
    }
    if (!comments.length) {
      note('No comments yet — be the first.');
      return;
    }
    list.textContent = '';
    for (const c of comments) {
      const item = document.createElement('article');
      item.className = 'swc-comment';
      const head = document.createElement('header');
      const name = document.createElement('strong');
      name.textContent = c.nickname;
      const time = document.createElement('time');
      time.dateTime = c.createdAt;
      time.textContent = new Date(c.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      head.append(name, time);
      const body = document.createElement('p');
      body.textContent = c.content;
      item.append(head, body);
      if (reactionsEnabled) item.appendChild(buildChips(c.id, reactions[c.id]));
      list.appendChild(item);
    }
  }

  async function load() {
    try {
      const res = await fetch(
        apiBase + '/comments?pageId=' + encodeURIComponent(pageId)
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      render(data.comments, data.reactions);
    } catch {
      note('Comments are unavailable right now.');
    }
  }
  load();

  // --- submit --------------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    submitBtn.disabled = true;
    statusEl.textContent = 'Posting…';
    try {
      const res = await fetch(apiBase + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId,
          pageTitle,
          nickname: fd.get('nickname'),
          content: fd.get('content'),
          website: fd.get('website'),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'something went wrong');
      statusEl.textContent = 'Thanks! Your comment will appear once approved.';
      form.querySelector('[name="content"]').value = '';
    } catch (err) {
      statusEl.textContent = 'Could not post comment: ' + err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
