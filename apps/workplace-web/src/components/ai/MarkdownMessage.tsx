import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

/**
 * AI(에이전트) 메시지 본문을 마크다운으로 렌더한다 (#356).
 *
 * 배경: AI 응답은 ## ** --- | 표 등 마크다운을 포함하는데, 사람 메시지용 plain-text 렌더로는
 * 원시 기호가 그대로 노출됐다. 사람 메시지는 기존 plain text 를 유지하고, AI 버블에만 이 컴포넌트를 쓴다.
 *
 * 디자인 시스템: hex/임의 색 금지 — 시맨틱 토큰(bg-muted/border-border/text-primary 등)만 사용.
 * tailwind typography 플러그인을 쓰지 않으므로 요소별 스타일을 components 로 직접 지정해 채팅 말풍선에 맞춘다.
 */
export function MarkdownMessage({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div
      data-testid="markdown-content"
      className={cn('space-y-2 break-words text-sm [overflow-wrap:anywhere]', className)}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap leading-relaxed">{children}</p>,
          h1: ({ children }) => <h1 className="text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc space-y-0.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-0.5 pl-5">{children}</ol>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          hr: () => <hr className="border-border" />,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          // 펜스 코드블록(language-*)은 pre 가 배경을 담당하므로 그대로, 인라인 코드만 배경 스타일.
          code: ({ className: codeClassName, children }) =>
            /language-/.test(codeClassName ?? '') ? (
              <code className={codeClassName}>{children}</code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
            ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{children}</pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
