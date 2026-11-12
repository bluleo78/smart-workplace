// AI 도움말 답 표식을 그리는 react-markdown 요소 표 덧씌우기(WP-1511).
// MarkdownMessage 가 helpAnswer 가 켜졌을 때만 기본 요소 표 위에 이 표를 씌운다 — 켜지지 않은 호출자(이슈 코멘트 등)는 바뀌지 않는다.
//  - strong → 화면 문구(ScreenPhrase)   - a: help: 출처 · dialog: 창 열기 단추 · manual-gap: 칩, 그 밖은 기본 링크
//  - img: figure: 매뉴얼 그림   - pre: ```evidence 접힌 근거, 그 밖은 기본 코드 블록
import type { ComponentProps, ElementType } from 'react'
import type { Components } from 'react-markdown'

import { isAiDialogTargetId } from '@/lib/aiDialogTargets'

import { AiDialogButton } from './AiDialogButton'
import { EvidenceBlock } from './EvidenceBlock'
import { EVIDENCE_LANG, HELP_ANSWER_SCHEMES } from './helpAnswer'
import { HelpAnswerFigure } from './HelpAnswerFigure'
import { HelpSourceLink } from './HelpSourceLink'
import { ManualGapChip } from './ManualGapChip'
import { ScreenPhrase } from './ScreenPhrase'

/** 첫 figure: 그림에 rehype 단계가 다는 표식 속성(hast 속성 이름). 둘째부터는 그리지 않는다. */
const FIRST_FIGURE_PROP = 'dataFirstFigure'

type HastLike = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastLike[] }

/**
 * rehype 단계 — 문서 순서로 첫 `figure:<figureId>` 그림 하나에만 표식을 단다. 그림은 답당 최대 1장이라는 규칙을 렌더 순서와 무관하게
 * 순수하게 지키려는 것(렌더 중 카운터는 StrictMode 이중 렌더에서 깨진다). figureId 가 없으면(본문에 figure: 그림 없음) 아무것도 하지 않는다.
 */
export function markFirstFigure(figureId: string | null) {
  return () => (tree: HastLike) => {
    if (!figureId) return
    const want = `${HELP_ANSWER_SCHEMES.figure}${figureId}`
    const walk = (n: HastLike): boolean => {
      if (n.tagName === 'img' && n.properties?.src === want) {
        n.properties = { ...n.properties, [FIRST_FIGURE_PROP]: true }
        return true
      }
      return n.children?.some(walk) ?? false
    }
    walk(tree)
  }
}

/** 링크(a) — 표식 스킴별로 그리고, 표식이 아니면 기본 링크 렌더로 넘긴다. */
function helpAnswerLink(base: Components['a']): Components['a'] {
  return function HelpAnswerLink(props: ComponentProps<'a'> & { node?: unknown }) {
    const { href, children } = props
    if (href?.startsWith(HELP_ANSWER_SCHEMES.help)) {
      return <HelpSourceLink id={href.slice(HELP_ANSWER_SCHEMES.help.length)}>{children}</HelpSourceLink>
    }
    if (href?.startsWith(HELP_ANSWER_SCHEMES.dialog)) {
      // 허용 목록 밖 id 는 단추를 그리지 않는다. 단추 글은 목록의 라벨이라 AI 가 쓴 링크 글(children)은 버린다.
      const id = href.slice(HELP_ANSWER_SCHEMES.dialog.length)
      return isAiDialogTargetId(id) ? <AiDialogButton id={id} /> : null
    }
    if (href?.startsWith(HELP_ANSWER_SCHEMES.gap)) return <ManualGapChip />
    // helpAnswerUrlTransform 이 못 알아본 주소를 지운 링크 — 빈 주소 링크 대신 글로만.
    if (!href) return <>{children}</>
    // 기본 요소 렌더는 요소 이름별 props 타입이 달라 합쳐 쓰면 맞지 않으므로 ElementType 으로 넓혀 그대로 넘긴다.
    const Base = base as ElementType | undefined
    return Base ? <Base {...props} /> : <a href={href}>{children}</a>
  }
}

/** base 요소 표 위에 도움말 답 요소를 씌운다. */
export function withHelpAnswerComponents(base: Components): Components {
  const BaseImg = base.img as ElementType | undefined
  const BasePre = base.pre as ElementType | undefined
  return {
    ...base,
    strong: ({ children }) => <ScreenPhrase>{children}</ScreenPhrase>,
    a: helpAnswerLink(base.a),
    img: (props) => {
      const src = typeof props.src === 'string' ? props.src : ''
      if (src.startsWith(HELP_ANSWER_SCHEMES.figure)) {
        const first = (props.node as HastLike | undefined)?.properties?.[FIRST_FIGURE_PROP] === true
        return <HelpAnswerFigure figureId={src.slice(HELP_ANSWER_SCHEMES.figure.length)} alt={props.alt ?? ''} first={first} />
      }
      return BaseImg ? <BaseImg {...props} /> : <img src={props.src} alt={props.alt} />
    },
    pre: (props) => {
      const code = (props.node as HastLike | undefined)?.children?.[0]
      const cls = code?.properties?.className
      const isEvidence = Array.isArray(cls) && cls.includes(`language-${EVIDENCE_LANG}`)
      if (isEvidence) return <EvidenceBlock>{props.children}</EvidenceBlock>
      return BasePre ? <BasePre {...props} /> : <pre>{props.children}</pre>
    },
  }
}

