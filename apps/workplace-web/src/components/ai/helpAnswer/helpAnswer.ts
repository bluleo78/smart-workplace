// AI 가 도움말 질문에 답할 때 Markdown 에 심는 특수 링크 표식을 읽는 순수 함수 모음.
//  - [도움말 · X](help:<id>)   출처
//  - ![..](figure:<id>)        매뉴얼 그림
//  - [..](dialog:<id>)         창 열기 단추
//  - [매뉴얼 보강](manual-gap:) 매뉴얼 보강 칩
//  - ```evidence 코드 펜스      접힌 근거
// 렌더러(react-markdown)가 쓰는 URL 변환과 한 번 파싱으로 바닥줄 분리·첫 id 찾기만 담당하고 React 는 모른다.
import type { Nodes, Root } from 'mdast'

import { FIGURE_SCHEME, HELP_SCHEME, makeUrlTransform } from '@/components/help/helpSchemes'
import { markdownParser, mdastText, walkMdast } from '@/components/help/mdast'

/** 답 표식 링크의 스킴 — 렌더러가 href/src 접두로 구분한다. */
export const HELP_ANSWER_SCHEMES = {
  help: HELP_SCHEME,
  figure: FIGURE_SCHEME,
  dialog: 'dialog:',
  gap: 'manual-gap:',
} as const

/** 접힌 근거를 담는 코드 펜스의 언어 이름. */
export const EVIDENCE_LANG = 'evidence'

/**
 * react-markdown 의 urlTransform. 표식 스킴 넷만 그대로 통과시키고 나머지(javascript: 등)는 기본 변환에 맡겨 안전하게 걸러낸다.
 * 대소문자 규칙(정확히 소문자일 때만 표식)은 도움말 본문과 같은 makeUrlTransform 이 정한다 —
 * 바닥줄 분리·첫 id 찾기·렌더러가 모두 같은 규칙이라 「변환은 통과시켰는데 렌더러는 못 알아보는」 어긋남이 없다.
 */
export const helpAnswerUrlTransform = makeUrlTransform(Object.values(HELP_ANSWER_SCHEMES))

/** 바닥줄: 출처(없을 수 있음)와 매뉴얼 보강 칩 여부. */
export type HelpAnswerFooter = { source: { id: string; label: string } | null; gap: boolean }

/**
 * 이미 파싱한 트리에서 지정한 노드 종류·스킴의 첫 링크 url 에서 접두를 뗀 id 를 찾는다.
 * 코드 펜스·인라인 코드는 링크 노드가 아니라서 그 안의 표식은 자연히 무시된다.
 */
function firstIdIn(tree: Nodes, type: 'link' | 'image', scheme: string): string | null {
  let found: string | null = null
  walkMdast(tree, (n) => {
    if (n.type === type && n.url.startsWith(scheme)) {
      found = n.url.slice(scheme.length)
      return true
    }
  })
  return found
}

/**
 * 마지막 비지 않은 문단이 help:/manual-gap: 링크와 공백·「·」 만으로 이뤄졌으면
 * 바닥줄로 떼어 낸다. 아니면 footer 는 null 이고 본문은 원문 그대로다.
 * body 는 전체를 다시 직렬화하지 않고 소스 위치로 잘라 원문을 보존한다. 이미 파싱한 트리를 받는다.
 */
function splitFooterOf(markdown: string, tree: Root): {
  body: string
  footer: HelpAnswerFooter | null
} {
  const last = tree.children[tree.children.length - 1]
  if (!last || last.type !== 'paragraph' || last.position?.start.offset == null) {
    return { body: markdown, footer: null }
  }

  const footer: HelpAnswerFooter = { source: null, gap: false }
  let hasMarker = false
  for (const child of last.children) {
    if (child.type === 'text') {
      // 표식 사이에는 공백과 「·」 구분자만 허용한다.
      if (child.value.replace(/[\s·]/g, '') !== '') return { body: markdown, footer: null }
    } else if (child.type === 'link' && child.url.startsWith(HELP_ANSWER_SCHEMES.help)) {
      hasMarker = true
      if (!footer.source) {
        footer.source = { id: child.url.slice(HELP_ANSWER_SCHEMES.help.length), label: mdastText(child) }
      }
    } else if (child.type === 'link' && child.url.startsWith(HELP_ANSWER_SCHEMES.gap)) {
      hasMarker = true
      footer.gap = true
    } else {
      return { body: markdown, footer: null }
    }
  }
  if (!hasMarker) return { body: markdown, footer: null }

  return { body: markdown.slice(0, last.position.start.offset).trimEnd(), footer }
}

/** 답 한 번 해석 결과 — 본문·바닥줄·첫 그림 id·첫 출처 id. */
export type ParsedHelpAnswer = { body: string; footer: HelpAnswerFooter | null; figureId: string | null; sourceId: string | null }

/**
 * 도움말 답을 remark 로 한 번만 파싱해 바닥줄 분리·첫 그림·첫 출처를 함께 구한다.
 * 세 값을 따로 구하면 같은 글을 세 번 파싱하는데, 스트리밍 중에는 토큰마다 본문이 바뀌어 그만큼 낭비가 커서 한 번으로 묶었다.
 */
export function parseHelpAnswer(markdown: string): ParsedHelpAnswer {
  const tree = markdownParser.parse(markdown)
  return {
    ...splitFooterOf(markdown, tree),
    figureId: firstIdIn(tree, 'image', HELP_ANSWER_SCHEMES.figure),
    sourceId: firstIdIn(tree, 'link', HELP_ANSWER_SCHEMES.help),
  }
}
