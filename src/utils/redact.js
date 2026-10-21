// Redaction of the diagnostics that get attached to a public GitHub issue.
//
// A report is filed in a PUBLIC tracker, so anything that could identify the
// person reporting has to go: the Windows account name inside paths, e-mail
// addresses, and MAC addresses. IP addresses are deliberately KEPT - DAC
// troubleshooting is impossible without knowing which address the projector
// was on - and they are already visible to anyone on the LAN.
//
// The home directory is passed in rather than looked up here so this module
// stays free of Node built-ins and can be unit tested on its own.

export const redactPrivateInfo = (text, homeDir = '') => {
  if (text === null || text === undefined) return '';
  let out = String(text);
  if (homeDir) out = out.split(homeDir).join('<user>');
  // Covers paths that carry the account name but were produced with a
  // differently-cased drive letter, or from a machine other than this one.
  out = out.replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\s"']+/g, '$1<user>');
  out = out.replace(/([\\/]home[\\/])[^\\/\s"']+/g, '$1<user>');
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
  out = out.replace(/\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/g, '<mac>');
  return out;
};
