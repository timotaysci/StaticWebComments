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
 *
 * All user content is rendered with textContent — never innerHTML.
 */
(function () {
  const container = document.querySelector('[data-swc-comments]');
  if (!container) return;

  const pageId = container.getAttribute('data-page-id') || location.pathname;
  const pageTitle = container.getAttribute('data-page-title') || document.title;
  const apiBase = container.getAttribute('data-api-base') || '/api';

  // --- build DOM -----------------------------------------------------
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

  container.append(list, form);
  const statusEl = form.querySelector('.swc-status');
  const submitBtn = form.querySelector('.swc-submit');

  // --- render --------------------------------------------------------
  function note(text) {
    list.textContent = '';
    const p = document.createElement('p');
    p.className = 'swc-note';
    p.textContent = text;
    list.appendChild(p);
  }

  function render(comments) {
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
      list.appendChild(item);
    }
  }

  async function load() {
    try {
      const res = await fetch(
        `${apiBase}/comments?pageId=${encodeURIComponent(pageId)}`
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      render(data.comments);
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
      const res = await fetch(`${apiBase}/comments`, {
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
      statusEl.textContent = `Could not post comment: ${err.message}`;
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
