function cleanText(value, maxLen) {
  if (typeof value !== 'string') return '';
  // strip control chars except tab, newline, carriage return
  let out = '';
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    const isCtrl = (c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127;
    if (!isCtrl) out += ch;
  }
  return out.trim().slice(0, maxLen);
}

// Which page paths may receive comments/reactions. Tighten via the
// PAGE_ID_PATTERN app setting so bots can't create junk partitions.
const PAGE_ID_PATTERN = new RegExp(
  process.env.PAGE_ID_PATTERN || '^/[a-zA-Z0-9/_-]{1,200}$'
);

function isValidPageId(pageId) {
  return typeof pageId === 'string' && PAGE_ID_PATTERN.test(pageId);
}

// Reaction targets: the page itself, or a comment's UUID rowKey. The
// shape check matters — targetId ends up inside table query filters.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isValidTargetId(targetId) {
  return targetId === '_post' || UUID_RE.test(String(targetId));
}

// REACTION_EMOJIS app setting: comma-separated list, e.g. "👍,❤️,🚀"
function parseEmojiList(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 8);
  return list.length > 0 ? list : fallback;
}

module.exports = { cleanText, isValidPageId, isValidTargetId, parseEmojiList };
