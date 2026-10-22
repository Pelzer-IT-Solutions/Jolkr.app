// Generates one static error page per HTTP code, per domain, from template.html.
// nginx serves plain files for error_page, so each code needs its own file to
// carry copy that actually matches the failure.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(join(here, 'template.html'), 'utf8');

// One next step per page — never a menu of three escape hatches.
const CODES = {
  400: ['Bad request', "The server couldn't read that request."],
  401: ['Sign in required', 'This page needs an account.'],
  403: ['No access', "You don't have permission to view this."],
  404: ['Page not found', "This address doesn't lead anywhere."],
  410: ['Page gone', "This page was removed and won't come back."],
  413: ['File too large', 'Attachments can be up to 250 MB.'],
  429: ['Too many requests', 'Slow down for a moment, then try again.'],
  500: ['Something broke', 'An error on our side stopped this request.'],
  502: ['Jolkr is unreachable', "The server didn't answer. This usually clears within a minute."],
  503: ['Temporarily unavailable', 'Jolkr is down for maintenance.'],
  504: ['The server timed out', 'The request took too long to answer.'],
};

// jolkr.app serves the app itself, so the CTA stays relative; upload.jolkr.app
// and status.jolkr.app are bare endpoints and have to send people back to the
// main domain. status.jolkr.app proxies the API's /health page, so a 502 there
// is a likely state rather than an edge case — it is the page people land on
// precisely when the backend is unreachable.
const DOMAINS = {
  'jolkr.app': '/app/',
  'upload.jolkr.app': 'https://jolkr.app/app/',
  'status.jolkr.app': 'https://jolkr.app/app/',
};

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let written = 0;
for (const [domain, appHref] of Object.entries(DOMAINS)) {
  const outDir = join(here, 'dist', domain);
  mkdirSync(outDir, { recursive: true });

  for (const [code, [title, message]] of Object.entries(CODES)) {
    const html = template
      .replaceAll('{{CODE}}', code)
      .replaceAll('{{TITLE}}', escapeHtml(title))
      .replaceAll('{{MESSAGE}}', escapeHtml(message))
      .replaceAll('{{CTA_HREF}}', appHref)
      .replaceAll('{{CTA_LABEL}}', code === '401' ? 'Sign in' : 'Back to Jolkr');

    writeFileSync(join(outDir, `${code}.html`), html);
    written++;
  }

  // Hestia's stock document_errors ships a shared 50x.html; keep the name alive
  // so nothing that still points at it falls back to the bare nginx page.
  writeFileSync(join(outDir, '50x.html'), readFileSync(join(outDir, '502.html')));
  written++;
}

console.log(`${written} bestanden geschreven naar ${join(here, 'dist')}`);
