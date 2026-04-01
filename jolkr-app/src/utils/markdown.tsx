import { type ReactNode } from 'react'

/**
 * Lightweight chat-oriented markdown parser.
 * Supports: ```code blocks```, `inline code`, **bold**, *italic*,
 * ~~strikethrough~~, and auto-linked URLs.
 */
export function renderMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = []
  let key = 0

  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...parseInline(text.slice(lastIndex, match.index), key))
      key += 100
    }
    parts.push(
      <pre key={key++} className="md-codeblock">
        <code>{match[2].replace(/\n$/, '')}</code>
      </pre>,
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(...parseInline(text.slice(lastIndex), key))
  }

  return parts
}

function parseInline(text: string, startKey: number): ReactNode[] {
  const nodes: ReactNode[] = []
  let key = startKey

  const lines = text.split('\n')
  lines.forEach((line, li) => {
    if (li > 0) nodes.push(<br key={key++} />)

    const re =
      /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(__(.+?)__)|(~~(.+?)~~)|(`([^`]+?)`)|((https?:\/\/[^\s<]+))/g

    let last = 0
    let m: RegExpExecArray | null

    while ((m = re.exec(line)) !== null) {
      if (m.index > last) {
        nodes.push(line.slice(last, m.index))
      }

      if (m[1]) {
        nodes.push(<strong key={key++}>{m[2]}</strong>)
      } else if (m[3]) {
        nodes.push(<em key={key++}>{m[4]}</em>)
      } else if (m[5]) {
        nodes.push(<strong key={key++}>{m[6]}</strong>)
      } else if (m[7]) {
        nodes.push(<del key={key++}>{m[8]}</del>)
      } else if (m[9]) {
        nodes.push(
          <code key={key++} className="md-inline-code">
            {m[10]}
          </code>,
        )
      } else if (m[11]) {
        nodes.push(
          <a
            key={key++}
            className="md-link"
            href={m[12]}
            target="_blank"
            rel="noopener noreferrer"
          >
            {m[12]}
          </a>,
        )
      }

      last = m.index + m[0].length
    }

    if (last < line.length) {
      nodes.push(line.slice(last))
    }
  })

  return nodes
}
