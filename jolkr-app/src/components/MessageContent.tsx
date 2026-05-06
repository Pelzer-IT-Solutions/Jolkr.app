import { useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';
import { useServersStore } from '../stores/servers';
import { useGifFavoritesStore, extractGiphyId } from '../stores/gif-favorites';
import { renderUnicodeEmojis, isEmojiOnly } from '../utils/emoji';
import { getApiBaseUrl } from '../platform/config';
import { isTauri } from '../platform/detect';
import s from './MessageContent.module.css';

// Tauri's webview origin is `tauri.localhost`, so a relative `/api/...` URL
// stored by a web client resolves to a non-existent path. Prepend the public
// API origin in Tauri so cross-platform messages (GIFs, embeds) render.
const apiOrigin = getApiBaseUrl().replace(/\/api$/, '');
function resolveContentUrl(href: string): string {
  if (isTauri && href.startsWith('/api/')) return apiOrigin + href;
  return href;
}

// Unescape HTML entities that marked escapes in code blocks
function unescapeHtml(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Configure marked for chat-style markdown
// In marked v17, custom renderers that accept tokens must call
// this.parser.parseInline(tokens) to render inline markdown.
marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    paragraph({ tokens }) {
      const body = this.parser.parseInline(tokens);
      return `<p class="mb-0">${body}</p>`;
    },
    link({ href, tokens }) {
      const body = this.parser.parseInline(tokens);
      // Block dangerous protocols (javascript:, data:, vbscript:)
      const safeHref = /^(https?:\/\/|mailto:|#)/i.test(href ?? '') ? href : '#';
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="md-link">${body}</a>`;
    },
    strong({ tokens }) {
      const body = this.parser.parseInline(tokens);
      return `<strong>${body}</strong>`;
    },
    em({ tokens }) {
      const body = this.parser.parseInline(tokens);
      return `<em>${body}</em>`;
    },
    del({ tokens }) {
      const body = this.parser.parseInline(tokens);
      return `<del>${body}</del>`;
    },
    codespan({ text }) {
      return `<code class="md-inline-code">${text}</code>`;
    },
    code({ text, lang }) {
      const raw = unescapeHtml(text);
      let highlighted: string;
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(raw, { language: lang }).value;
      } else {
        highlighted = hljs.highlightAuto(raw).value;
      }
      const safeLang = lang ? lang.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
      const langLabel = safeLang ? `<div class="md-codelang">${safeLang}</div>` : '';
      return `<pre class="md-codeblock">${langLabel}<code class="hljs">${highlighted}</code></pre>`;
    },
    image({ href, title }) {
      const resolved = resolveContentUrl(href ?? '');
      const safeHref = /^(https?:\/\/|\/api\/)/i.test(resolved) ? escapeAttr(resolved) : '#';
      const safeTitle = title ? ` title="${escapeAttr(title)}"` : '';
      const isGif = GIF_PROXY_RE.test(href ?? '') || /\.gif(\?[^\s]*)?$/i.test(href ?? '');
      const maxW = isGif ? '250px' : '450px';
      const imgTag = `<img src="${safeHref}" alt="GIF"${safeTitle} style="max-width:${maxW};max-height:300px;border-radius:0.5rem" loading="lazy" referrerpolicy="no-referrer" />`;
      // Wrap GIF proxy images with a heart overlay for favorites
      if (GIF_PROXY_RE.test(href ?? '')) {
        const gifId = extractGiphyId(href ?? '');
        if (gifId) {
          return `<span class="gif-embed" data-gif-id="${escapeAttr(gifId)}" style="position:relative;display:inline-block;margin:0.25rem 0">${imgTag}<button class="gif-embed-heart" data-gif-id="${escapeAttr(gifId)}" type="button">${HEART_SVG}</button></span>`;
        }
      }
      return `<span style="display:inline-block;margin:0.25rem 0">${imgTag}</span>`;
    },
    heading({ tokens, depth }) {
      const body = this.parser.parseInline(tokens);
      return `<h${depth}>${body}</h${depth}>`;
    },
    blockquote({ tokens }) {
      const body = this.parser.parse(tokens);
      return `<blockquote class="md-blockquote">${body}</blockquote>`;
    },
    listitem({ tokens }) {
      const body = this.parser.parse(tokens);
      return `<li>${body}</li>`;
    },
  },
});

// Image URL patterns — render as <img> instead of <a>
const IMAGE_URL_RE = /\.(gif|png|jpe?g|webp)(\?[^\s]*)?$/i;
const GIF_PROXY_RE = /\/api\/gifs\/(media\?url=|i\/)/;

// Heart SVG for GIF favorite overlay (inline since we can't use React components in raw HTML)
const HEART_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;

// Auto-detect URLs in plain text that aren't already links
function autoLinkUrls(text: string): string {
  // Don't process if it already contains markdown links or HTML
  if (/\[.*?\]\(.*?\)/.test(text) || /<a\s/.test(text)) return text;
  return text.replace(
    /((?:https?:\/\/[^\s<>)"]+)|(?:\/api\/gifs\/(?:media\?url=|i\/)[^\s<>)"]+))/gi,
    (url) => {
      if (IMAGE_URL_RE.test(url) || GIF_PROXY_RE.test(url)) {
        return `![GIF](${url})`;
      }
      return `[${url}](${url})`;
    },
  );
}

// Highlight @mentions — only in text nodes, not inside HTML tags
function highlightMentions(html: string): string {
  return html.replace(
    /(<[^>]*>)|(@\w+)/g,
    (match, tag, mention) => {
      if (tag) return tag;
      if (mention) return `<span class="md-mention">${mention}</span>`;
      return match;
    },
  );
}

// Escape a string for safe use as an HTML attribute value
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Replace custom emoji shortcodes (:name:) with img tags
function renderCustomEmojis(html: string, emojiMap?: Map<string, string>): string {
  if (!emojiMap || emojiMap.size === 0) return html;
  return html.replace(
    /(<[^>]*>)|:(\w{1,32}):/g,
    (match, tag, name) => {
      if (tag) return tag; // Don't replace inside HTML tags
      if (name) {
        const url = emojiMap.get(name);
        if (url) {
          // Validate URL and escape attribute values to prevent injection
          try { new URL(url); } catch { return match; }
          const safeUrl = escapeAttr(url);
          const safeName = escapeAttr(name);
          return `<img src="${safeUrl}" alt=":${safeName}:" title=":${safeName}:" style="display:inline-block;vertical-align:text-bottom;width:1.25rem;height:1.25rem" loading="lazy" referrerpolicy="no-referrer" />`;
        }
      }
      return match;
    },
  );
}

export interface MessageContentProps {
  content: string;
  className?: string;
  emojiMap?: Map<string, string>;
  serverId?: string;
}

const ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'a', 'code', 'pre', 'br', 'p', 'del', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'span', 'img', 'div', 'button', 'svg', 'path'];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'style', 'src', 'alt', 'title', 'loading', 'draggable', 'referrerpolicy', 'crossorigin', 'data-gif-id', 'type', 'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd'];

export default memo(function MessageContent({ content, className, emojiMap, serverId }: MessageContentProps) {
  // Build emoji map from store if serverId is provided and no explicit emojiMap
  const storeEmojis = useServersStore((s) => serverId ? s.emojis[serverId] : undefined);
  const resolvedEmojiMap = useMemo(() => {
    if (emojiMap) return emojiMap;
    if (!storeEmojis || storeEmojis.length === 0) return undefined;
    const m = new Map<string, string>();
    for (const e of storeEmojis) {
      m.set(e.name, e.image_url);
    }
    return m;
  }, [emojiMap, storeEmojis]);

  const emojiOnly = useMemo(() => isEmojiOnly(content), [content]);

  const html = useMemo(() => {
    if (!content) return '';
    const withLinks = autoLinkUrls(content);
    const raw = marked.parse(withLinks, { async: false }) as string;
    // Sanitize to prevent XSS
    const sanitized = DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR });
    // Highlight @mentions, then render custom emojis, then unicode emojis as images
    const withMentions = highlightMentions(sanitized);
    const withCustomEmojis = renderCustomEmojis(withMentions, resolvedEmojiMap);
    const withUnicodeEmojis = renderUnicodeEmojis(withCustomEmojis, emojiOnly ? 48 : 20);
    // Re-sanitize to ensure all injected HTML is safe
    return DOMPurify.sanitize(withUnicodeEmojis, { ALLOWED_TAGS, ALLOWED_ATTR });
  }, [content, resolvedEmojiMap, emojiOnly]);

  // GIF favorite hearts — sync visual state with store
  const containerRef = useRef<HTMLDivElement>(null);
  const favIds = useGifFavoritesStore((s) => s.ids);
  const toggleFav = useGifFavoritesStore((s) => s.toggle);

  // Update heart button fill state whenever favIds changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const hearts = el.querySelectorAll<HTMLButtonElement>('.gif-embed-heart');
    hearts.forEach((btn) => {
      const gifId = btn.getAttribute('data-gif-id');
      if (!gifId) return;
      const isFav = favIds.has(gifId);
      btn.setAttribute('data-fav', String(isFav));
      // Update SVG fill
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none');
    });
  }, [favIds, html]);

  // Click handler via event delegation
  const handleClick = useCallback((e: React.MouseEvent) => {
    const heart = (e.target as HTMLElement).closest('.gif-embed-heart') as HTMLElement | null;
    if (!heart) return;
    e.preventDefault();
    e.stopPropagation();
    const gifId = heart.getAttribute('data-gif-id');
    if (gifId) toggleFav(gifId);
  }, [toggleFav]);

  return (
    <div
      ref={containerRef}
      className={`${emojiOnly ? s.emojiOnly : ''} ${className ?? ''}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
});
