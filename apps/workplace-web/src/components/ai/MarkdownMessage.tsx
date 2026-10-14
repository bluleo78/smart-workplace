import { type ReactNode, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { Link, useInRouterContext, useLocation } from 'react-router-dom'
import remarkGfm from 'remark-gfm'

import { chatLinkSessionId, isInternalHref, withChatParam } from '@/lib/aiChatLink'
import { cn } from '@/lib/utils'

const REMARK_PLUGINS = [remarkGfm]

// 블록 요소 — 이 앞뒤에 낀 공백 전용 텍스트는 원문의 줄바꿈이 아니라 mdast→hast 변환이 끼워 넣는 포맷용 공백이다(section 은 GFM 각주).
const BLOCK_TAGS = new Set([
  'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'div', 'section', 'details', 'summary', 'dl', 'dt', 'dd',
])
type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[] }
const isBlock = (n: HastNode | undefined) => n?.type === 'element' && BLOCK_TAGS.has(n.tagName ?? '')

/**
 * pre-wrap(p·li) 아래에서 원문에 없던 빈 칸·빈 줄로 그려지는 포맷용 공백을 지운다(트리는 렌더마다 새로 만들어지므로 제자리에서 고친다).
 * - 블록 옆에 낀 공백 전용 텍스트: 남기면 목록 항목·문단 사이가 한 줄씩 벌어지거나 빈 칸이 생긴다.
 * - 체크박스(input) 바로 뒤 공백: 체크박스가 absolute 라 글자만 한 칸 밀린다.
 * - 하드 브레이크(br) 바로 뒤 개행: br 과 개행이 둘 다 줄바꿈으로 그려져 빈 줄이 생긴다.
 * 인라인 요소 사이의 soft break("**a**\n*b*")는 원문 줄바꿈이므로 남긴다.
 */
function stripLayoutWhitespace(node: HastNode) {
  const kids = node.children
  if (!kids) return
  node.children = kids.filter((c, i) => {
    if (c.type !== 'text') return true
    const prev = kids[i - 1]
    if (/^\s+$/.test(c.value ?? '') && (isBlock(prev) || isBlock(kids[i + 1]))) return false
    if (prev?.tagName === 'input') c.value = c.value?.replace(/^\s+/, '')
    else if (prev?.tagName === 'br') c.value = c.value?.replace(/^\n/, '')
    return c.value !== ''
  })
  node.children.forEach(stripLayoutWhitespace)
}
const REHYPE_PLUGINS = [() => stripLayoutWhitespace]

/** 목록 클래스 — 체크리스트(contains-task-list)면 불릿 없이 얕게, 아니면 지정한 불릿 스타일. */
function listClass(className: string | undefined, marker: string): string {
  return className?.includes('contains-task-list') ? 'list-none space-y-0.5 pl-1' : `${marker} space-y-0.5 pl-5`
}

/** 새 탭 링크 — 외부 링크와 라우터 밖(정적 렌더) 링크 공용. */
function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
      {children}
    </a>
  )
}

/**
 * AI 답 안 링크(WP-384) — 같은 출처 상대 경로는 라우터로 같은 탭에서 연다.
 * - 대화 딥링크("/?chat=<id>"): 지금 화면·쿼리·router state 에 머문 채 chat 만 더해 replace — AiChatDeepLink 가 그 대화를 열고 파라미터를 지운다
 *   (push 하면 곧 지워질 항목이 남아 뒤로 가기가 한 번 헛돈다).
 * - 다른 화면 링크: 이동 직전에 onPageLink(전체 화면 AI 를 내려 이동한 화면이 보이게 — AIChatPanel 이 준다).
 * 외부 링크·라우터 밖(정적 렌더)은 이전처럼 새 탭.
 */
function AiLink({ href, children, onPageLink }: { href?: string; children?: ReactNode; onPageLink?: () => void }) {
  const inRouter = useInRouterContext()
  if (!inRouter || !isInternalHref(href)) return <ExternalLink href={href}>{children}</ExternalLink>
  const chatId = chatLinkSessionId(href)
  return chatId ? <ChatLink id={chatId}>{children}</ChatLink> : (
    <Link to={href} onClick={onPageLink} data-testid="markdown-internal-link" className="text-primary underline">
      {children}
    </Link>
  )
}

/** 대화 딥링크 — 라우터 안에서만 그린다(useLocation). */
function ChatLink({ id, children }: { id: string; children?: ReactNode }) {
  const location = useLocation()
  return (
    <Link
      to={{ pathname: location.pathname, search: withChatParam(location.search, id), hash: location.hash }}
      replace
      state={location.state}
      data-testid="markdown-internal-link"
      className="text-primary underline"
    >
      {children}
    </Link>
  )
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
  // 항목 안 줄바꿈(「3. 항목\n이어지는 문장」)은 p 처럼 pre-wrap 으로 보존한다 — tight list 의 li 는 p 없이 글자를 바로 담는다.
  // 체크리스트 항목 — 체크박스를 왼쪽 여백에 절대배치해, 긴 항목이 줄바꿈돼도 둘째 줄이 체크박스 밑으로 파고들지 않고
  // 글머리 들여쓰기(hanging indent)를 유지한다. loose list 에선 체크박스가 li 직속이 아닌 p 안에 들어가도 li 기준으로 놓인다.
  li: ({ children, className }) => (
    <li className={cn('whitespace-pre-wrap', className?.includes('task-list-item') && 'relative pl-5')}>{children}</li>
  ),
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
  a: ({ children, href }) => <ExternalLink href={href}>{children}</ExternalLink>,
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
 * internalLinks 가 켜지면 상대 경로 링크를 라우터로 같은 탭에서 연다(WP-384). onPageLink 는 대화가 아닌 화면 링크로 이동하기 직전에 부른다.
 *
 * 디자인 시스템: hex/임의 색 금지 — 시맨틱 토큰(bg-muted/border-border/text-primary 등)만 사용.
 * tailwind typography 플러그인을 쓰지 않으므로 요소별 스타일을 components 로 직접 지정해 채팅 말풍선에 맞춘다.
 */
export function MarkdownMessage({
  children,
  className,
  renderImage,
  internalLinks,
  onPageLink,
}: {
  children: string
  className?: string
  renderImage?: (props: { src?: string; alt?: string }) => ReactNode
  /** WP-384: AI 답 — 같은 출처 상대 경로를 같은 탭 라우터 링크로(AIChatPanel 이 켠다). 다른 호출자는 이전처럼 모두 새 탭. */
  internalLinks?: boolean
  /** WP-384: 답 안 다른 화면 링크로 이동하기 직전 — 전체 화면 AI 를 내린다(AIChatPanel). */
  onPageLink?: () => void
}) {
  const components = useMemo<Components>(() => {
    const withImage: Components = renderImage
      ? { ...BASE_COMPONENTS, img: ({ src, alt }) => renderImage({ src: typeof src === 'string' ? src : undefined, alt }) }
      : BASE_COMPONENTS
    return internalLinks
      ? { ...withImage, a: ({ href, children: c }) => <AiLink href={href} onPageLink={onPageLink}>{c}</AiLink> }
      : withImage
  }, [renderImage, internalLinks, onPageLink])
  return (
    <div
      data-testid="markdown-content"
      // whitespace-normal: 호출자 말풍선의 pre-wrap 을 끊는다. 줄바꿈 보존은 p·li 가 직접 맡고, 블록 사이 포맷용 개행은 stripLayoutWhitespace 가 지운다.
      className={cn('space-y-2 whitespace-normal break-words text-sm [overflow-wrap:anywhere]', className)}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
