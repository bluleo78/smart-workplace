import { type ReactNode, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

const REMARK_PLUGINS = [remarkGfm]

/** 목록 클래스 — 체크리스트(contains-task-list)면 불릿 없이 얕게, 아니면 지정한 불릿 스타일. */
function listClass(className: string | undefined, marker: string): string {
  return className?.includes('contains-task-list') ? 'list-none space-y-0.5 pl-1' : `${marker} space-y-0.5 pl-5`
}

/** 요소별 스타일 — 렌더마다 객체를 새로 만들지 않도록 모듈 범위에 둔다. */
const BASE_COMPONENTS: Components = {
  p: ({ children }) => <p className="whitespace-pre-wrap leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="text-base font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
  // GFM 체크리스트(`- [ ]`)는 remark-gfm 이 ul.contains-task-list > li.task-list-item > input 으로 낸다(WP-254).
  // 불릿과 체크박스가 겹쳐 보이지 않도록 체크리스트 목록만 불릿을 끄고 들여쓰기를 줄인다(일반 목록은 그대로).
  ul: ({ children, className }) => (
    <ul className={listClass(className, 'list-disc')}>{children}</ul>
  ),
  ol: ({ children, className }) => (
    <ol className={listClass(className, 'list-decimal')}>{children}</ol>
  ),
  // 체크리스트 항목 — 체크박스를 왼쪽 여백에 절대배치해, 긴 항목이 줄바꿈돼도 둘째 줄이 체크박스 밑으로 파고들지 않고
  // 글머리 들여쓰기(hanging indent)를 유지한다. loose list 에선 체크박스가 li 직속이 아닌 p 안에 들어가도 li 기준으로 놓인다.
  li: ({ children, className }) =>
    className?.includes('task-list-item') ? <li className="relative pl-5">{children}</li> : <li>{children}</li>,
  // remark-gfm 이 내는 input 은 체크리스트 체크박스뿐(원시 HTML 비허용) — 원문의 [x]/[ ] 상태만 읽기 전용으로 보여준다.
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled
      readOnly
      className="absolute left-0 top-[0.3em] size-3.5 accent-primary"
    />
  ),
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
}

/**
 * AI(에이전트) 메시지 본문을 마크다운으로 렌더한다 (#356).
 *
 * 배경: AI 응답은 ## ** --- | 표 등 마크다운을 포함하는데, 사람 메시지용 plain-text 렌더로는
 * 원시 기호가 그대로 노출됐다. 사람 메시지는 기존 plain text 를 유지하고, AI 버블에만 이 컴포넌트를 쓴다.
 *
 * renderImage 가 있을 때만 img 를 그 렌더러로 그린다(WP-199 이슈 본문 이미지) — 공용 컴포넌트가 특정 도메인
 * 컴포넌트를 import 하지 않도록 호출자가 주입한다. 없으면 react-markdown 기본 img 렌더를 그대로 쓴다.
 *
 * 디자인 시스템: hex/임의 색 금지 — 시맨틱 토큰(bg-muted/border-border/text-primary 등)만 사용.
 * tailwind typography 플러그인을 쓰지 않으므로 요소별 스타일을 components 로 직접 지정해 채팅 말풍선에 맞춘다.
 */
export function MarkdownMessage({
  children,
  className,
  renderImage,
}: {
  children: string
  className?: string
  renderImage?: (props: { src?: string; alt?: string }) => ReactNode
}) {
  const components = useMemo<Components>(
    () =>
      renderImage
        ? { ...BASE_COMPONENTS, img: ({ src, alt }) => renderImage({ src: typeof src === 'string' ? src : undefined, alt }) }
        : BASE_COMPONENTS,
    [renderImage],
  )
  return (
    <div
      data-testid="markdown-content"
      className={cn('space-y-2 break-words text-sm [overflow-wrap:anywhere]', className)}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
