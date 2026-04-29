// Pure DOM helper functions for the contentEditable rich text input.
// Emoji characters are stored in the DOM as <img alt="😀"> elements.

import { emojiToImgUrl } from '../../utils/emoji';

// Unicode emoji regex — matches compound emojis (ZWJ sequences, skin tones, flags, keycaps).
// Order matters: longest sequences first.
const EMOJI_REGEX_GLOBAL =
  /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*(?:\uD83C[\uDFFB-\uDFFF])?|[\u{1F1E0}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/gu;

// Non-global variant for fast-path existence check (avoids lastIndex state issues).
const EMOJI_REGEX_TEST =
  /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*(?:\uD83C[\uDFFB-\uDFFF])?|[\u{1F1E0}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/u;

/**
 * Recursively extract plain text from a contentEditable element.
 * - <img alt="😀"> → "😀"
 * - <br>           → "\n"
 * - <div>          → "\n" + recurse into children
 */
export function getPlainText(el: HTMLElement): string {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tag = element.tagName.toUpperCase();
      if (tag === 'IMG') {
        text += (element as HTMLImageElement).alt ?? '';
      } else if (tag === 'BR') {
        text += '\n';
      } else if (tag === 'DIV') {
        text += '\n' + getPlainText(element);
      } else {
        text += getPlainText(element);
      }
    }
  }
  return text;
}

/**
 * Return the plain-text content from the start of `root` up to the current
 * cursor position, or null if there is no selection inside `root`.
 */
export function getTextBeforeCursor(root: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  // Create a range that spans from the start of root to the cursor.
  const before = document.createRange();
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);

  // Extract into a temporary fragment and read its plain text.
  const fragment = before.cloneContents();
  const tmp = document.createElement('div');
  tmp.appendChild(fragment);
  return getPlainText(tmp);
}

/**
 * Create an <img> element representing a Unicode emoji.
 * src comes from the Apple CDN via emojiToImgUrl; alt is the raw emoji char.
 */
export function createEmojiImg(emoji: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = emojiToImgUrl(emoji);
  img.alt = emoji;
  img.loading = 'lazy';
  return img;
}

/**
 * Walk all text nodes inside `el` and replace any Unicode emoji sequences
 * with <img> elements produced by createEmojiImg.
 *
 * Returns true if at least one replacement was made.
 */
export function convertEmojisInElement(el: HTMLElement): boolean {
  let changed = false;

  // Collect text nodes first (walker becomes invalid once we mutate the DOM).
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';
    if (!text || !EMOJI_REGEX_TEST.test(text)) continue;

    // Reset lastIndex before using the global regex.
    EMOJI_REGEX_GLOBAL.lastIndex = 0;

    const parent = textNode.parentNode;
    if (!parent) continue;

    // Split the text into alternating non-emoji / emoji segments and rebuild.
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    EMOJI_REGEX_GLOBAL.lastIndex = 0;
    while ((match = EMOJI_REGEX_GLOBAL.exec(text)) !== null) {
      const matchStart = match.index;

      // Text before the emoji.
      if (matchStart > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchStart)));
      }

      // The emoji image.
      fragment.appendChild(createEmojiImg(match[0]));

      lastIndex = matchStart + match[0].length;
      changed = true;
    }

    // Any remaining text after the last emoji.
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    parent.replaceChild(fragment, textNode);
  }

  return changed;
}

/**
 * Return the plain-text character offset of the current cursor inside `root`,
 * or null if there is no selection inside `root`.
 */
export function getPlainTextOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  const before = document.createRange();
  before.setStart(root, 0);
  before.setEnd(range.startContainer, range.startOffset);

  const fragment = before.cloneContents();
  const tmp = document.createElement('div');
  tmp.appendChild(fragment);
  return getPlainText(tmp).length;
}

/**
 * Walk the DOM tree of `root` and place the cursor at `targetOffset`
 * plain-text characters from the beginning.
 *
 * Plain-text character counting:
 * - Text nodes  → each character counts as 1
 * - <img>       → alt.length characters
 * - <br>        → 1 character ("\n")
 */
export function setCursorToOffset(root: HTMLElement, targetOffset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  // Alias that TypeScript narrows as non-null for the nested walk() closure
  const selection: Selection = sel;

  let remaining = targetOffset;

  function walk(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true; // done
      }
      remaining -= len;
      return false;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toUpperCase();

      if (tag === 'IMG') {
        const altLen = ((el as HTMLImageElement).alt ?? '').length;
        if (remaining < altLen) {
          // Place cursor before the image.
          const parent = el.parentNode!;
          const idx = Array.prototype.indexOf.call(parent.childNodes, el);
          const range = document.createRange();
          range.setStart(parent, idx);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }
        remaining -= altLen;
        return false;
      }

      if (tag === 'BR') {
        if (remaining === 0) {
          const parent = el.parentNode!;
          const idx = Array.prototype.indexOf.call(parent.childNodes, el);
          const range = document.createRange();
          range.setStart(parent, idx);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return true;
        }
        remaining -= 1;
        return false;
      }

      for (const child of node.childNodes) {
        if (walk(child)) return true;
      }
    }

    return false;
  }

  const placed = walk(root);

  // If targetOffset is beyond all content, place cursor at the end.
  if (!placed) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
