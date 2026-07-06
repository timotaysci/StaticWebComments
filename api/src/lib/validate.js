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

module.exports = { cleanText };
