// The Report window hands the user a link to a pre-filled GitHub issue, and
// the application menu can open the project page. Both go through the shell,
// so the set of hosts that may be opened is fixed here rather than being
// decided by whatever string happens to be in a message.
//
// `https:` only. A custom scheme or a local file path would let renderer
// content launch arbitrary programs.

export const EXTERNAL_URL_ALLOWLIST = new Set([
  'github.com',
  'www.github.com',
  'githubusercontent.com',
  'raw.githubusercontent.com',
  'polaraudio.github.io',
]);

export const isAllowedExternalUrl = (target) => {
  let parsed;
  try {
    parsed = new URL(String(target));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return EXTERNAL_URL_ALLOWLIST.has(parsed.hostname.toLowerCase());
};
