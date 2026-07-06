// SWA injects the authenticated user as a base64 JSON header on every
// request that passed its route rules. Route-level allowedRoles in
// staticwebapp.config.json is the primary gate; this check is defence
// in depth in case a route rule is ever loosened by mistake.
const MODERATOR_ROLE = process.env.MODERATOR_ROLE || 'moderator';

function getPrincipal(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function isModerator(request) {
  const principal = getPrincipal(request);
  return Boolean(principal?.userRoles?.includes(MODERATOR_ROLE));
}

module.exports = { getPrincipal, isModerator };
