import { useMemo, memo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';
import { useServersStore } from '../stores/servers';
import { renderUnicodeEmojis, isEmojiOnly } from '../utils/emoji';

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
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline">${body}</a>`;
    },
    strong({ tokens }) {
      const body = this.parser.parseInline(tokens);
      return `<strong class="font-bold">${body}</strong>`;
    },
    em({ tokens }) {
      const body = this.parser.parseInline(tokens);
      return `<em class="italic">${body}</em>`;
    },
    del({ tokens }) {
      const body = this.parser.parseInline(tokens);
      return `<del class="line-through">${body}</del>`;
    },
    codespan({ text }) {
      return `<code class="px-1 py-0.5 bg-black/30 rounded text-sm text-pink-300 font-mono">${text}</code>`;
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
      const langLabel = safeLang ? `<div class="text-xs text-text-tertiary">${safeLang}</div>` : '';
      return `<pre class="bg-black/30 rounded-md p-3 my-1 overflow-x-auto">${langLabel}<code class="text-sm font-mono hljs !p-0">${highlighted}</code></pre>`;
    },
    heading({ tokens, depth }) {
      const body = this.parser.parseInline(tokens);
      return `<h${depth} class="font-bold">${body}</h${depth}>`;
    },
    blockquote({ tokens }) {
      const body = this.parser.parse(tokens);
      return `<blockquote class="border-l-4 border-text-muted/30 pl-3 my-1 text-text-secondary">${body}</blockquote>`;
    },
    listitem({ tokens }) {
      const body = this.parser.parse(tokens);
      return `<li>${body}</li>`;
    },
  },
});

// Auto-detect URLs in plain text that aren't already links
function autoLinkUrls(text: string): string {
  // Don't process if it already contains markdown links or HTML
  if (/\[.*?\]\(.*?\)/.test(text) || /<a\s/.test(text)) return text;
  return text.replace(
    /(https?:\/\/[^\s<>)"]+)/gi,
    '[$1]($1)',
  );
}

// Highlight @mentions — only in text nodes, not inside HTML tags
function highlightMentions(html: string): string {
  return html.replace(
    /(<[^>]*>)|(@\w+)/g,
    (match, tag, mention) => {
      if (tag) return tag;
      if (mention) return `<span class="px-0.5 rounded bg-accent/20 text-accent font-medium cursor-pointer hover:underline">${mention}</span>`;
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
          return `<img src="${safeUrl}" alt=":${safeName}:" title=":${safeName}:" class="inline-block h-5 w-5 align-text-bottom" loading="lazy" referrerpolicy="no-referrer" crossorigin="anonymous" />`;
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

const ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'a', 'code', 'pre', 'br', 'p', 'del', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'span', 'img', 'div'];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'src', 'alt', 'title', 'loading', 'draggable', 'referrerpolicy', 'crossorigin'];

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

  return (
    <div
      className={`max-w-none ${emojiOnly ? 'leading-10' : ''} ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
