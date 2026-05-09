import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Eye, FileCode } from 'lucide-react';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';
import DOMPurify from 'dompurify';
import type { Attachment } from '../../api/types';
import { formatBytes } from '../../utils/format';
import { useAuthedRedirectUrl } from '../../hooks/useAuthedRedirectUrl';
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

/** Whether this attachment is an SVG — gets the toggle between code and a
 *  sanitised inline preview. Both extension and MIME are accepted because
 *  servers occasionally type SVGs as `text/xml` or `application/octet-stream`. */
function isSvg(att: Attachment): boolean {
  return att.content_type.toLowerCase() === 'image/svg+xml'
    || /\.svg(\?.*)?$/i.test(att.filename);
}

/** Run an SVG body through DOMPurify with the SVG profile enabled.
 *
 *  The SVG profile keeps the tags + attributes that make a normal SVG render
 *  correctly (transforms, fills, strokes, gradients, filters, <use>, <defs>,
 *  paths, polygons, masks, animations) and strips the dangerous surface:
 *  `<script>`, `<foreignObject>`, `on*` event handlers, `javascript:` URLs,
 *  external resource loading via `xlink:href` to non-fragment targets, etc.
 *  We do not need to maintain that whitelist ourselves — DOMPurify already
 *  publishes one and keeps it current.
 *
 *  ADD_TAGS for `style` is intentional: a lot of designer-exported SVGs ship
 *  inline `<style>` blocks for class-based fills. The SVG profile already
 *  permits the `class` attribute, so allowing `<style>` lets those render
 *  faithfully without opening the door to script (DOMPurify still strips
 *  script content even inside `<style>` via its CSS parser). */
function sanitiseSvg(raw: string): string {
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    // Force fragments so any standalone <?xml … ?> / <!DOCTYPE> headers
    // get stripped — only the `<svg>` element survives, which is the only
    // thing we want to inject into our document.
    WHOLE_DOCUMENT: false,
  });
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
  // Single round-trip: the signed stream-token URL is fetchable without a
  // Bearer header (Range-aware, scoped to caller), so the same URL backs
  // both the inline body fetch AND the download anchor. Previous version
  // paid for two byte-streams: an `authedFetch` for the text plus a
  // separate full-body blob via `useAuthedFileUrl` for the download.
  const streamUrl = useAuthedRedirectUrl(src);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // SVG attachments default to the visual preview (most useful first) and
  // can be flipped to the code view on demand. Non-SVG content has no
  // toggle and renders code only. Lifted state so the toggle button can
  // re-render the body block.
  const svg = isSvg(attachment);
  const [viewMode, setViewMode] = useState<'preview' | 'code'>(svg ? 'preview' : 'code');

  const tooLarge = attachment.size_bytes > MAX_INLINE_CODE_BYTES;
  const lang = detectLanguage(attachment.filename);
  const downloadUrl = streamUrl ?? src;

  // Skipped for too-large files — those render the download chip without
  // parsing the body (loading MB-sized text into hljs freezes the renderer).
  useEffect(() => {
    if (tooLarge || !streamUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(streamUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = await resp.text();
        if (!cancelled) setText(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load file');
      }
    })();
    return () => { cancelled = true; };
  }, [streamUrl, tooLarge]);

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
        {svg && text != null && !error && (
          <button
            type="button"
            className={s.actionBtn}
            onClick={() => setViewMode((m) => (m === 'preview' ? 'code' : 'preview'))}
            title={viewMode === 'preview' ? t('codeBlock.viewCode') : t('codeBlock.viewPreview')}
            aria-label={viewMode === 'preview' ? t('codeBlock.viewCode') : t('codeBlock.viewPreview')}
          >
            {viewMode === 'preview'
              ? <FileCode size={15} strokeWidth={1.6} />
              : <Eye size={15} strokeWidth={1.6} />}
          </button>
        )}
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
        ) : svg && viewMode === 'preview' ? (
          // SVG preview: DOMPurify scrubs script / event handlers / external
          // refs but keeps transforms / fills / gradients / animations so
          // designer-exported SVGs render faithfully. The body container's
          // own scroll + max-height is reused; the inline SVG fills width.
          <div
            className={s.svgPreview}
            dangerouslySetInnerHTML={{ __html: sanitiseSvg(text) }}
          />
        ) : (
          <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
        )}
        {!expanded && text != null && viewMode === 'code' && text.split('\n').length > 12 && <div className={s.fade} />}
      </div>

      {text != null && viewMode === 'code' && text.split('\n').length > 12 && (
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
