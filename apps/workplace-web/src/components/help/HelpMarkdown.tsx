// 도움말 절 본문 그리기(WP-1505) — 매뉴얼 절 markdown 을 패널 폭에 맞는 글 스타일로 그리고, 도움말만의 표기를 화면 동작으로 바꾼다.
// - `![alt](figure:<id>)` → 묶음의 그림(`/help/figures/…`), 누르면 큰 그림 대화상자. 없는 id·로드 실패는 alt 글.
// - `[글](help:<절 id>)` → 패널 안 절 이동(onNavigate). 바깥 주소는 새 탭.
// - 코드 블록 → 오른쪽 복사 단추 열(자리표시를 채운 뒤의 명령을 복사). 단추는 코드 칸 밖이라 긴 줄을 덮지 않는다.
// - 굵은 글자 → 마우스를 올리면 같은 이름의 화면 버튼을 강조(helpScreenControls). 반대로 화면에서 포커스·클릭한 단추 이름과 같으면 글자를 강조(WP-1506).
// 글 크기·간격은 채팅 MarkdownMessage 와 맞추되 컴포넌트는 가져다 쓰지 않는다 — 그쪽은 멘션·이슈 키 처리 등 채팅 전용 단계가 섞여 있다(목록 클래스만 공용 markdownListClass).
import { Check, Copy } from 'lucide-react'
import { createContext, memo, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { copyToClipboard } from '@/lib/copyToClipboard'
import { markdownListClass } from '@/lib/markdownListClass'
import { cn } from '@/lib/utils'

import { HelpActiveControlContext } from './helpActiveControl'
import type { HelpSection, HelpVars } from './helpBundle'
import { HelpFigureFallback, HelpFigureImage } from './HelpFigureImage'
import { applyHelpConditions, type HelpValues, remarkHelpPlaceholders } from './helpMarkup'
import { FIGURE_SCHEME, HELP_SCHEME, makeUrlTransform } from './helpSchemes'
import { normalizeControlText } from './helpScreenControls'
import { nodeText } from './nodeText'
import { useScreenHighlight } from './useScreenHighlight'

/** 복사 성공 뒤 체크 아이콘을 보이는 시간(ms). */
const COPIED_MS = 2000

// 주소 정리 — help:·figure: 만 그대로 두고 나머지는 기본 규칙(javascript: 등 차단)을 따른다.
const helpUrlTransform = makeUrlTransform([HELP_SCHEME, FIGURE_SCHEME])

/**
 * 코드 블록(pre) 안인가 — react-markdown 10 은 code 에 inline 여부를 넘기지 않고, 언어 없는 펜스는 className 도 없어
 * 인라인 코드와 구별되지 않는다. CodeBlock 이 true 로 감싸 그 안의 code 에 인라인 코드 스타일이 겹치지 않게 한다.
 */
const InCodeBlock = createContext(false)

/** 코드 — 블록 안이면 언어 class 만, 인라인이면 작은 배경 상자. */
function HelpCode({ className, children }: { className?: string; children?: ReactNode }) {
  const inBlock = useContext(InCodeBlock)
  if (inBlock) return <code className={className}>{children}</code>
  return <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
}

/** 코드 블록 + 오른쪽 복사 단추 열. 복사할 글은 그려진 코드(자리표시를 채운 뒤)에서 읽는다. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  // 체크 아이콘을 2초 뒤 되돌린다 — 닫히거나 절이 바뀌어 사라지면 타이머도 치운다.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = async () => {
    // mdast → hast 가 코드 블록 끝에 줄바꿈 하나를 붙이므로 떼어 원문 명령 그대로 복사한다.
    const text = (preRef.current?.textContent ?? '').replace(/\n$/, '')
    const ok = await copyToClipboard(text, { success: '복사했습니다' })
    if (ok) setCopied(true)
  }
  // 단추를 코드 위에 띄우지(absolute) 않고 코드 칸 옆 제 열에 둔다 — 띄우면 긴 줄이 가로로 넘칠 때 오른쪽 여백(pr)이 스크롤 끝에만 생겨
  // 보이는 자리의 코드 글자를 단추가 덮는다. 코드는 pre(min-w-0) 안에서만 가로로 스크롤된다.
  return (
    <div className="flex items-start rounded bg-muted">
      <pre ref={preRef} className="min-w-0 flex-1 overflow-x-auto p-2 text-xs">
        <InCodeBlock.Provider value={true}>{children}</InCodeBlock.Provider>
      </pre>
      <button
        type="button"
        aria-label="복사"
        title="복사"
        data-testid="help-code-copy"
        onClick={() => void copy()}
        className="m-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  )
}

/**
 * 굵은 글자 — 마우스를 올린 동안 같은 이름의 화면 버튼을 강조한다. 올린 채 사라지면(절 이동) 강조도 거둔다.
 * 반대 방향(WP-1506): 화면에서 포커스·클릭한 단추 이름(HelpActiveControlContext)과 정규화한 글자가 같으면
 * data-help-active 와 강조 색을 달아 「지금 누른 그 단추」 설명이 어디인지 보이게 한다.
 */
function HighlightStrong({ children }: { children?: ReactNode }) {
  const activeControl = useContext(HelpActiveControlContext)
  const text = nodeText(children)
  const active = activeControl !== null && normalizeControlText(text) === activeControl
  const { enter, stop } = useScreenHighlight(text)
  return (
    <strong
      data-help-active={active ? '' : undefined}
      className={cn('font-semibold', active && 'rounded-sm bg-primary/10 px-0.5 text-primary')}
      onMouseEnter={(e) => void enter(e.currentTarget.textContent ?? '')}
      onMouseLeave={stop}
    >
      {children}
    </strong>
  )
}

export interface HelpMarkdownProps {
  section: HelpSection
  values: HelpValues
  vars: HelpVars | null
  /**
   * help: 절 링크를 눌렀을 때 — 절 id 를 넘긴다(장 찾기·이동은 패널이).
   * 부모는 onNavigate·canNavigate 를 안정된 참조(useCallback)로 넘긴다 — markdown 컴포넌트 표(useMemo)가 이 둘에 의존해
   * 렌더마다 새 함수가 오면 본문 전체가 다시 마운트된다(복사 체크 표시·그림 확대 상태가 풀린다).
   */
  onNavigate: (sectionId: string) => void
  /** 이 절로 갈 수 있는지 — 일반 구성원에게 숨긴 관리자 장 절 등은 false 로 주면 링크 없이 글로만 보인다. 없으면 모두 이동. 안정된 참조로(위 참고). */
  canNavigate?: (sectionId: string) => boolean
}

/**
 * 도움말 절 본문. 조건 블록을 먼저 문자열로 처리하고, 자리표시는 remark 플러그인으로 채운 뒤 그린다.
 * memo — 패널은 도킹 칸·AI 상태가 바뀔 때도 다시 그려지는데, props(절·값·안정된 콜백)가 같으면 markdown 을 다시 해석하지 않는다.
 */
export const HelpMarkdown = memo(function HelpMarkdown({ section, values, vars, onNavigate, canNavigate }: HelpMarkdownProps) {
  const markdown = useMemo(() => applyHelpConditions(section.markdown, values.conditions, vars), [section.markdown, values.conditions, vars])
  const remarkPlugins = useMemo(() => [remarkGfm, remarkHelpPlaceholders({ values: values.placeholders, vars })], [values.placeholders, vars])

  const components = useMemo<Components>(
    () => ({
      p: ({ children }) => <p className="leading-relaxed">{children}</p>,
      h1: ({ children }) => <h1 className="text-base font-semibold">{children}</h1>,
      h2: ({ children }) => <h2 className="text-sm font-semibold">{children}</h2>,
      h3: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
      h4: ({ children }) => <h4 className="text-sm font-semibold">{children}</h4>,
      ul: ({ children, className }) => <ul className={markdownListClass(className, 'list-disc')}>{children}</ul>,
      ol: ({ children, className }) => <ol className={markdownListClass(className, 'list-decimal')}>{children}</ol>,
      li: ({ children, className }) => <li className={cn('leading-relaxed', className?.includes('task-list-item') && 'relative pl-5')}>{children}</li>,
      hr: () => <hr className="border-border" />,
      blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
      code: ({ className, children }) => <HelpCode className={className}>{children}</HelpCode>,
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      table: ({ children }) => (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">{children}</table>
        </div>
      ),
      th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>,
      td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
      strong: ({ children }) => <HighlightStrong>{children}</HighlightStrong>,
      a: ({ href, children }) => {
        if (href?.startsWith(HELP_SCHEME)) {
          const id = href.slice(HELP_SCHEME.length)
          if (canNavigate && !canNavigate(id)) return <>{children}</>
          // 패널 안 이동이라 주소를 바꾸지 않는다 — 링크 모양의 단추.
          return (
            <button type="button" onClick={() => onNavigate(id)} className="text-primary underline underline-offset-2 hover:opacity-80">
              {children}
            </button>
          )
        }
        // 주소 정리(defaultUrlTransform)가 javascript:·data: 등을 빈 값으로 바꾼 링크 — 빈 주소 새 탭 대신 글로만.
        if (!href) return <>{children}</>
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            {children}
          </a>
        )
      },
      img: ({ src, alt }) => {
        const raw = typeof src === 'string' ? src : ''
        const figure = raw.startsWith(FIGURE_SCHEME) ? section.figures.find((f) => f.id === raw.slice(FIGURE_SCHEME.length)) : undefined
        return figure ? <HelpFigureImage figure={figure} /> : <HelpFigureFallback alt={alt ?? ''} />
      },
    }),
    [section.figures, onNavigate, canNavigate],
  )

  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground">
      {/* skipHtml — react-markdown 10 은 raw HTML 노드를 글자로 그린다. 매뉴얼의 `<!-- 주석 -->` 은 PDF 처럼 보이지 않아야 한다
          (묶음 생성 help-bundle.mjs 도 주석은 보이지 않는다고 전제한다). */}
      <ReactMarkdown skipHtml remarkPlugins={remarkPlugins} urlTransform={helpUrlTransform} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
})
