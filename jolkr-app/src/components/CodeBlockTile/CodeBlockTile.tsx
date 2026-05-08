import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileCode } from 'lucide-react';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';
import type { Attachment } from '../../api/types';
import { formatBytes } from '../../utils/format';
import { authedFetch } from '../../api/client';
import { useAuthedFileUrl } from '../../hooks/useAuthedFileUrl';
import { useT } from '../../hooks/useT';
import s from './CodeBlockTile.module.css';

export interface CodeBlockTileProps {
  attachment: Attachment;
  /** Resolved URL — same value MessageAttachments hands to the other tiles. */
  src: string;
}

// Beyond this we render a download chip instead of a code block; loading
// MB-sized text into innerHTML and asking highlight.js to walk it freezes
// the renderer for too long.
const MAX_INLINE_CODE_BYTES = 1_000_000;

// Map filename suffix → highlight.js language id (only when our hint is
// stronger than the auto-detector). hljs handles the rest via highlightAuto.
const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', php: 'php',
  rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  lua: 'lua', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  css: 'css', scss: 'scss', less: 'less',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini',
  md: 'markdown', markdown: 'markdown',
  xml: 'xml', svg: 'xml', html: 'xml', htm: 'xml',
  vue: 'xml', svelte: 'xml',
  ini: 'ini', conf: 'ini', cfg: 'ini', env: 'bash',
  diff: 'diff', patch: 'diff',
  dockerfile: 'dockerfile', makefile: 'makefile',
  log: 'plaintext', txt: 'plaintext',
};

function detectLanguage(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return EXT_TO_LANG[ext] ?? null;
}

/**
 * Inline code-snippet preview for text-based attachments. Fetches the
 * authed blob, runs it through highlight.js (with a filename → language
 * hint when we have one, else `highlightAuto`), and renders inside a
 * scrollable Jolkr-styled block. Falls back to a generic file chip when
 * the blob is too large to highlight comfortably.
 */
export default function CodeBlockTile({ attachment, src }: CodeBlockTileProps) {
  const { t } = useT();
  const blobUrl = useAuthedFileUrl(src);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const tooLarge = attachment.size_bytes > MAX_INLINE_CODE_BYTES;
  const lang = detectLanguage(attachment.filename);
  const downloadUrl = blobUrl ?? src;

  // Pull the text directly via authedFetch instead of through the blob
  // URL. fetch(blobUrl) is gated by the page's `connect-src` CSP and our
  // current policy doesn't list `blob:`, so the blob path produced a
  // "Failed to fetch" error chip even though the bytes were already in
  // memory. authedFetch is the same call useAuthedFileUrl makes
  // internally, just consumed as text. Skipped for too-large files —
  // those render the download chip without parsing.
  useEffect(() => {
    if (tooLarge) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await authedFetch(src);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = await resp.text();
        if (!cancelled) setText(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load file');
      }
    })();
    return () => { cancelled = true; };
  }, [src, tooLarge]);

  // Highlight once we have the body. Empty / errored renders fall through
  // to a placeholder shell so the chip doesn't pop in awkwardly.
  let highlighted = '';
  let resolvedLang = lang ?? '';
  if (text != null) {
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(text, { language: lang }).value;
      } else {
        const auto = hljs.highlightAuto(text);
        highlighted = auto.value;
        if (!resolvedLang && auto.language) resolvedLang = auto.language;
      }
    } catch {
      // Highlight.js never throws under normal use, but if it ever does
      // we still want the raw text legible — fall back to escaped HTML.
      highlighted = escapeHtml(text);
    }
  }

  // Heuristic: large file → don't even try to inline. Show a download chip
  // styled like the regular .file row from MessageAttachments.
  if (tooLarge) {
    return (
      <div className={s.wrap}>
        <div className={s.header}>
          <span className={s.iconWrap}><FileCode size={15} strokeWidth={1.6} /></span>
          <div className={s.meta}>
            <span className={s.filename} title={attachment.filename}>{attachment.filename}</span>
            <span className={s.subtitle}>{formatBytes(attachment.size_bytes)}</span>
          </div>
          <a
            className={s.actionBtn}
            href={downloadUrl}
            download={attachment.filename}
            title={t('codeBlock.download')}
            aria-label={t('codeBlock.download')}
          >
            <Download size={15} strokeWidth={1.6} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      <div className={s.header}>
        <span className={s.iconWrap}><FileCode size={15} strokeWidth={1.6} /></span>
        <div className={s.meta}>
          <span className={s.filename} title={attachment.filename}>{attachment.filename}</span>
          <span className={s.subtitle}>
            <span>{formatBytes(attachment.size_bytes)}</span>
            {resolvedLang && <span className={s.lang}>· {resolvedLang}</span>}
          </span>
        </div>
        <a
          className={s.actionBtn}
          href={downloadUrl}
          download={attachment.filename}
          title={t('codeBlock.download')}
          aria-label={t('codeBlock.download')}
        >
          <Download size={15} strokeWidth={1.6} />
        </a>
      </div>

      <div className={s.body} data-expanded={expanded}>
        {error ? (
          <div className={s.errorBody}>{error}</div>
        ) : text == null ? (
          <pre><code className="hljs">{t('codeBlock.loading')}</code></pre>
        ) : (
          <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
        )}
        {!expanded && text != null && text.split('\n').length > 12 && <div className={s.fade} />}
      </div>

      {text != null && text.split('\n').length > 12 && (
        <button type="button" className={s.expandBar} onClick={() => setExpanded(v => !v)}>
          {expanded ? (
            <><ChevronUp size={13} style={{ marginRight: 4 }} />{t('codeBlock.collapse')}</>
          ) : (
            <><ChevronDown size={13} style={{ marginRight: 4 }} />{t('codeBlock.expand')}</>
          )}
        </button>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
