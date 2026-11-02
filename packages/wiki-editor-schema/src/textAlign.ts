// 문단·제목 가로 정렬(WP-1305) — 문단(paragraph)·제목(heading) 노드에 textAlign 속성을 더한다.
//
// 저장 형식: 정렬된 블록을 GitHub README 관례의 `<div align="…">` HTML 블록으로 감싼다(빈 줄을 두어 안쪽은 마크다운으로 읽힌다).
//   <div align="center">
//
//   가운데 **제목**
//
//   </div>
// 왜 이 모양인가:
// - 안쪽이 마크다운 그대로라 멘션 토큰·링크·굵게가 깨지지 않는다(<p style> 로 쓰면 안쪽이 HTML 이라 마크다운이 읽히지 않는다).
// - GitHub 등 다른 마크다운 화면도 가운데·오른쪽으로 그린다. 정렬을 모르는 화면(옛 판·AI 요약)은 div 만 버리고 글은 그대로 남는다.
// - class·style 이 없는 div 라 모양 영역(wikiHtmlBox — div[class]·div[style] 만 잡는다)으로 읽히지 않는다.
// 같은 정렬의 이웃 블록은 div 하나로 묶는다(앞 형제와 같으면 여는 태그, 뒤 형제와 같으면 닫는 태그를 생략).
// 읽을 때는 문단·제목의 parseHTML 이 자기 style/align 이나 바로 위 부모 div[align] 을 본다 — div 자체는 규칙이 없어 안쪽만 살아난다.
// 정렬은 문서 최상위·인용·모양 영역(상자) 바로 안 블록에만 둔다(canAlignIn). 목록 항목·할 일 항목 안에 감싸개를 쓰면 항목 사이에 빈 줄이 생겨
// 촘촘한 목록이 다시 읽을 때 느슨한 목록이 되고, 표 셀은 셀 정렬(WP-584)이 따로 있으며 GFM 셀은 문단 직렬화기를 거치지 않는다.
// 그 밖 자리의 정렬 속성(붙여넣기 등으로 들어온 것)은 저장 때 버린다 — 웹 도구도 같은 판정으로 정렬 메뉴를 숨긴다.
import { Heading } from '@tiptap/extension-heading'
import { Paragraph } from '@tiptap/extension-paragraph'
import { defaultMarkdownSerializer, type MarkdownSerializerState } from '@tiptap/pm/markdown'
import type { Fragment, Node as PMNode } from '@tiptap/pm/model'

import { WIKI_HTML_BOX } from './htmlNodes'

/** 저장되는 정렬 값 — null 은 기본(왼쪽). 'left' 를 따로 두지 않는다(정렬 없음이 곧 왼쪽이라 저장본이 두 갈래가 되지 않게). */
export type WikiTextAlign = 'center' | 'right' | null

/**
 * HTML 의 text-align·align 값(또는 Yjs 로 들어온 attrs 값)을 저장 값으로 — center/right 만 남기고 모르는 값·문자열 아님은 기본(null).
 * 표 셀 정렬(tableCellAlign.ts parseCellAlign)도 같은 판정을 쓴다.
 */
export function parseTextAlign(value: unknown): WikiTextAlign {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : null
  return v === 'center' || v === 'right' ? v : null
}

/** 정렬 감싸개를 둘 수 있는 부모 노드 — 문서 최상위·인용·모양 영역. 위 머리 주석의 까닭으로 목록 항목·표 셀은 뺀다. */
const ALIGN_PARENTS: ReadonlySet<string> = new Set(['doc', 'blockquote', WIKI_HTML_BOX])

/** 이 부모(노드 종류 이름) 바로 안의 문단·제목을 정렬할 수 있는지 — 직렬화기와 웹 서식 도구가 같은 판정을 쓴다. */
export function canAlignIn(parentTypeName: string): boolean {
  return ALIGN_PARENTS.has(parentTypeName)
}

/** Yjs 로 들어온 attrs 는 파싱을 지나지 않으므로 렌더·직렬화에서도 같은 판정을 다시 쓴다. */
function alignOf(node: PMNode | null | undefined): WikiTextAlign {
  if (!node || (node.type.name !== 'paragraph' && node.type.name !== 'heading')) return null
  return parseTextAlign(node.attrs.textAlign)
}

/**
 * 요소의 정렬 — 자기 style text-align·align 속성(노트끼리 복사 HTML·표 HTML 폴백), 없으면 바로 위 부모가 정렬 감싸개 div[align] 일 때 그 값.
 * 부모 하나만 본다 — 더 먼 조상까지 보면 정렬 div 안 목록의 문단까지 정렬이 번진다.
 */
function parseAlignFromElement(el: HTMLElement): WikiTextAlign {
  // style 속성이 없는 요소(대부분의 마크다운 문단)는 CSSOM(el.style)을 건드리지 않는다.
  const own = parseTextAlign((el.hasAttribute('style') && el.style.textAlign) || el.getAttribute('align'))
  if (own) return own
  const parent = el.parentElement
  return parent && parent.tagName === 'DIV' && parent.hasAttribute('align') ? parseTextAlign(parent.getAttribute('align')) : null
}

/** 문단·제목 공통 textAlign 속성 정의 — 화면 렌더는 style 로(편집기·공개 공유·판 미리보기·노트끼리 복사 HTML). */
const textAlignAttribute = {
  textAlign: {
    default: null as WikiTextAlign,
    parseHTML: (el: HTMLElement) => parseAlignFromElement(el),
    renderHTML: (attrs: { textAlign?: unknown }) => {
      const align = parseTextAlign(attrs.textAlign)
      return align ? { style: `text-align: ${align}` } : {}
    },
  },
}

/** 직렬화 때 형제 블록 — prosemirror-markdown 이 넘기는 parent 는 노드이거나(문서·목록 항목·인용) 조각이다. */
function siblingAt(parent: PMNode | Fragment, index: number): PMNode | null {
  if (index < 0) return null
  // 노드만 type 을 지닌다 — 조각이면 그대로 형제 목록이다.
  const content = 'type' in parent ? parent.content : parent
  return index < content.childCount ? content.child(index) : null
}

/**
 * 정렬 감싸개를 둘러 기본 직렬화기를 부른다. 정렬이 없으면 기본 그대로라 기존 저장본은 바이트가 같다.
 * 부모가 정렬을 둘 수 없는 자리(목록 항목·표 셀 등, canAlignIn)면 정렬을 버리고 기본 그대로 쓴다 — 촘촘한 목록이 느슨해지지 않게.
 * 조각(부모가 노드가 아님)은 최상위로 본다.
 * closeBlock 뒤 다음 write 가 빈 줄을 먼저 내므로 `<div>`·안쪽·`</div>` 사이에 빈 줄이 생긴다(안쪽이 마크다운으로 읽히는 조건).
 */
function withAlignWrapper(
  base: (state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number) => void,
) {
  return function serialize(state: MarkdownSerializerState, node: PMNode, parent: PMNode | Fragment, index: number) {
    const align = alignOf(node)
    if (!align || ('type' in parent && !canAlignIn(parent.type.name))) {
      base(state, node, parent as PMNode, index)
      return
    }
    const sameAsPrev = alignOf(siblingAt(parent, index - 1)) === align
    const sameAsNext = alignOf(siblingAt(parent, index + 1)) === align
    if (!sameAsPrev) {
      state.write(`<div align="${align}">`)
      state.closeBlock(node)
    }
    base(state, node, parent as PMNode, index)
    if (!sameAsNext) {
      state.write('</div>')
      state.closeBlock(node)
    }
  }
}

/**
 * 정렬 속성과 감싸개 직렬화기를 더한 확장 — 문단·제목이 같은 모양이라 한곳에서 만든다.
 * markdown.parse 는 두지 않는다 — tiptap-markdown 이 기본 명세와 합치고, 감싸개는 HTML 블록이라 parseHTML 이 부모 div[align] 을 읽는다.
 */
function withTextAlign<T extends typeof Paragraph | typeof Heading>(base: T, serialize: Parameters<typeof withAlignWrapper>[0]): T {
  return base.extend({
    addAttributes() {
      return { ...this.parent?.(), ...textAlignAttribute }
    },
    addStorage() {
      return { markdown: { serialize: withAlignWrapper(serialize) } }
    },
  }) as T
}

/** 정렬 속성을 더한 문단. */
export const WikiParagraph = withTextAlign(Paragraph, defaultMarkdownSerializer.nodes.paragraph)

/** 정렬 속성을 더한 제목. */
export const WikiHeading = withTextAlign(Heading, defaultMarkdownSerializer.nodes.heading)
