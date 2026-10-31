// 노트 본문 HTML 모양 보존(WP-1240) — HTML 아티팩트의 모양(카드·배지·여백)을 노트 편집기 안에서 그대로 보이게 하면서
// 안 글자는 일반 노트처럼 바로 편집·동시 편집하게 하는 노드 둘·마크 하나.
//
// 저장 형식(Markdown 에 CommonMark HTML 블록을 섞는다):
//   <style data-wp-style>            ← wikiStyle(1번 종류 HTML 블록 — </style> 까지. 저장 때 빈 줄은 뺀다 — cssForBlock)
//   .card{background:#0f172a}
//   </style>
//
//   <div class="card" style="margin:8px">   ← wikiHtmlBox(6번 종류 — 빈 줄에서 끝나므로 안쪽이 마크다운으로 파싱된다)
//
//   매출 **₩1.2B** <span class="badge" style="color:#16a34a">좋음</span>   ← wikiHtmlSpan(인라인 HTML)
//
//   </div>
// tiptap-markdown(html:true)은 markdown-it 이 낸 HTML 을 DOM 으로 파싱해 아래 parseHTML 규칙으로 노드를 만든다.
// 속성은 파싱·렌더·직렬화 모두 htmlSanitize.ts 를 거친다(Yjs 로 들어온 attrs 는 파싱을 지나지 않는다).
import { Mark, Node } from '@tiptap/core'
import type { MarkdownSerializerState } from '@tiptap/pm/markdown'
import type { Mark as PMMark, Node as PMNode } from '@tiptap/pm/model'

import {
  escapeHtmlAttr,
  sanitizeBoxTag,
  sanitizeClassName,
  sanitizeInlineStyle,
  sanitizeStyleSheet,
  WIKI_HTML_BOX_TAGS,
} from './htmlSanitize'

/** renderHTML 용 속성 묶음 — 정리 후 빈 값은 넣지 않는다. */
function renderAttrs(className: unknown, style: unknown): Record<string, string> {
  const cls = sanitizeClassName(className)
  const st = sanitizeInlineStyle(style)
  return { ...(cls ? { class: cls } : {}), ...(st ? { style: st } : {}) }
}

/** class·style 를 HTML 속성 글자로 — 둘 다 정리 후 비면 빈 글자. 직렬화(여는 태그)가 쓴다. renderAttrs 를 그대로 써 정리는 한 번만 한다. */
function attrText(className: unknown, style: unknown): string {
  return Object.entries(renderAttrs(className, style))
    .map(([k, v]) => ` ${k}="${escapeHtmlAttr(v)}"`)
    .join('')
}

/** class·style 중 정리 후 남는 것이 있는지 — 속성 글자를 만들지 않고 판정만 한다(앞 값이 남으면 뒤는 정리하지 않는다). */
function hasAttrs(className: unknown, style: unknown): boolean {
  return !!(sanitizeClassName(className) || sanitizeInlineStyle(style))
}

/** 모양 영역·인라인 모양이 함께 쓰는 class·style 속성 정의 — 파싱 때 정리하고, renderHTML 이 직접 그리므로 자동 렌더는 끈다. */
const SHAPE_ATTRIBUTES = {
  className: { default: null, parseHTML: (el: HTMLElement) => sanitizeClassName(el.getAttribute('class')), rendered: false },
  style: { default: null, parseHTML: (el: HTMLElement) => sanitizeInlineStyle(el.getAttribute('style')), rendered: false },
}

/** 모양 노드·마크 이름 — 화면 범위(wikiHtmlScope)·붙여넣기 거르기(wikiPasteShape)가 같은 판정을 쓰게 한곳에 둔다. */
const WIKI_STYLE = 'wikiStyle'
const WIKI_HTML_BOX = 'wikiHtmlBox'
const WIKI_HTML_SPAN = 'wikiHtmlSpan'

/** 이 노드가 HTML 모양을 지녔는지 — 페이지 스타일·모양 영역 노드이거나 인라인 모양 마크가 붙은 노드. */
export function isWikiShapeNode(node: PMNode): boolean {
  const name = node.type.name
  return name === WIKI_STYLE || name === WIKI_HTML_BOX || node.marks.some((m) => m.type.name === WIKI_HTML_SPAN)
}

/**
 * class·style 이 정리 후에도 남는 요소인지 — 남는 게 없으면 노드·마크를 만들지 않는다(속성 없는 <div> 와 같게 내용만 살린다).
 * 표 HTML 폴백(#742·#754)이 내보내는 div.tableWrapper 는 표 렌더 부산물이라 모양 영역으로 잡지 않는다 — 잡으면 기존 표 저장본이
 * 다시 저장될 때 <div class="tableWrapper"> 상자로 바뀐다.
 */
function hasShape(el: HTMLElement): boolean {
  if (el.classList.contains('tableWrapper')) return false
  return hasAttrs(el.getAttribute('class'), el.getAttribute('style'))
}

/**
 * 페이지 스타일 노드 `wikiStyle` — 노트 전체에 적용되는 CSS 한 덩어리(attrs.css). 문서 어디든 둘 수 있으나 변환기는 보통 맨 앞에 둔다.
 * - atom 블록: 안 글자를 편집 대상으로 두지 않는다(CSS 는 칩 하나로 보이고 지울 수 있다 — 웹 NodeView).
 * - 스키마 전용 렌더(서버·클립보드·NodeView 없는 화면)는 `media="not all"` 로 내보내 어떤 화면에도 적용되지 않게 한다 —
 *   범위 가두기 없이 앱 전체에 CSS 가 새는 일을 막는다. 실제 적용은 웹이 노트 본문 범위로 가둬 주입한다(wikiHtmlScope).
 * - parseHTML 은 data-wp-style 이 붙은 <style> 만 — 붙지 않은 <style>(외부 붙여넣기)은 지금처럼 버린다(ProseMirror ignoreTags).
 * - 렌더·직렬화하는 CSS 에는 빈 줄을 두지 않는다(cssForBlock) — 표 HTML 폴백(#742) 안에 들면 6번 종류 HTML 블록이 빈 줄에서 끊긴다.
 */
export const WikiStyleSchema = Node.create({
  name: WIKI_STYLE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      css: {
        default: '',
        parseHTML: (el: HTMLElement) => sanitizeStyleSheet(el.textContent ?? '').trim(),
        rendered: false,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'style[data-wp-style]' }]
  },

  renderHTML({ node }) {
    return ['style', { 'data-wp-style': '', media: 'not all' }, cssForBlock(node.attrs.css)]
  },

  addStorage() {
    return {
      markdown: {
        // state.text(…, false) — 줄마다 목록·인용 들여쓰기(delim)를 붙이고 이스케이프하지 않는다(코드 블록 직렬화와 같은 방식).
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const css = cssForBlock(node.attrs.css)
          state.write('<style data-wp-style>')
          state.ensureNewLine()
          if (css) {
            state.text(css, false)
            state.ensureNewLine()
          }
          state.write('</style>')
          state.closeBlock(node)
        },
        parse: {
          // markdown-it(html:true)이 HTML 블록으로 그대로 내보내고 parseHTML 이 받는다.
        },
      },
    }
  },
})

/**
 * 저장·렌더용 CSS — 정리(sanitizeStyleSheet)하고 앞뒤 공백과 빈 줄(공백뿐인 줄)을 뺀다.
 * 왜 빈 줄을 빼는가: 맨 바깥의 <style> 은 1번 종류 HTML 블록이라 </style> 까지 이어지지만, 병합 셀 표처럼 HTML 로 폴백하는
 * 표(6번 종류 — 빈 줄에서 끝난다) 셀 안에 들면 CSS 의 빈 줄에서 블록이 끊겨 표와 CSS 가 깨진다. CSS 문자열은 줄바꿈을 품을 수 없어
 * 빈 줄을 빼도 뜻이 같다(주석 안 빈 줄만 사라진다). 다시 읽은 값에는 빈 줄이 없어 두 번째 저장부터 바이트가 같다.
 */
function cssForBlock(css: unknown): string {
  return sanitizeStyleSheet(css)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .join('\n')
    .trim()
}

/** 모양 영역 parseHTML 선택자 — 허용 태그 중 class 또는 style 이 있는 것만(속성 없는 div 는 지금처럼 내용만 살린다). */
const BOX_SELECTOR = WIKI_HTML_BOX_TAGS.flatMap((t) => [`${t}[class]`, `${t}[style]`]).join(',')

/**
 * 모양 영역 노드 `wikiHtmlBox` — class·style 을 지닌 컨테이너(카드·열·배너)를 그 모양 그대로 두고 안쪽 블록은 일반 노트처럼 편집한다.
 * - content block+: 안쪽은 문단·목록·표·중첩 영역 등 일반 블록. defining: 안을 통째로 바꿔 붙여도 영역이 남는다.
 * - renderHTML 은 저장된 tag 그대로 + 정리한 class/style, contentDOM 이 요소 자신이다 — React NodeView 래퍼를 끼우면
 *   `.grid > .item` 같은 자식 선택자·grid/flex 배치가 깨지므로 웹도 NodeView 없이 이 렌더를 쓴다(경계 점선은 CSS).
 * - 직렬화: 여는 태그·빈 줄·안쪽·빈 줄·닫는 태그 — 빈 줄이 있어야 markdown-it 이 안쪽을 마크다운으로 읽는다.
 */
export const WikiHtmlBox = Node.create({
  name: WIKI_HTML_BOX,
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      tag: { default: 'div', parseHTML: (el: HTMLElement) => sanitizeBoxTag(el.tagName), rendered: false },
      ...SHAPE_ATTRIBUTES,
    }
  },

  parseHTML() {
    return [{ tag: BOX_SELECTOR, getAttrs: (el: HTMLElement) => (hasShape(el) ? null : false) }]
  },

  renderHTML({ node }) {
    // data-wiki-html-box — 웹 CSS 가 편집 중 경계 점선을 그리는 표지(원본 class 와 겹치지 않게 속성으로 둔다).
    return [sanitizeBoxTag(node.attrs.tag), { ...renderAttrs(node.attrs.className, node.attrs.style), 'data-wiki-html-box': '' }, 0]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const tag = sanitizeBoxTag(node.attrs.tag)
          state.write(`<${tag}${attrText(node.attrs.className, node.attrs.style)}>`)
          // closeBlock → 다음 write 가 빈 줄(\n\n)을 먼저 낸다. 안쪽 마지막 블록도 닫힌 상태라 닫는 태그 앞에도 빈 줄이 생긴다.
          state.closeBlock(node)
          state.renderContent(node)
          state.write(`</${tag}>`)
          state.closeBlock(node)
        },
        parse: {
          // markdown-it(html:true)이 여는/닫는 태그를 HTML 블록으로 내보내고, DOM 파싱에서 안쪽 블록이 이 요소 자식이 된다.
        },
      },
    }
  },
})

/**
 * 인라인 모양 범위 마크 `wikiHtmlSpan` — <span class style> 로 감싼 글자(배지·색 글자). 안 글자는 일반 텍스트라 편집·동시 편집된다.
 * - 멘션 칩(span[data-mtype])은 노드라 잡지 않는다.
 * - excludes '': 서로 다른 class 의 span 이 겹쳐도(중첩 span) 둘 다 남긴다 — 기본(자기 배제)이면 바깥 span 모양이 사라진다.
 * - inclusive false: 범위 끝에서 이어 친 글자는 범위 밖(배지 뒤 일반 글자) — 링크와 같은 동작.
 * - 확장 목록 맨 앞에 등록해 다른 마크보다 바깥에 쓰이게 한다(extensions.ts) — `가**<span>나</span>**다` 처럼 **가 태그 바깥에
 *   붙으면 CommonMark 강조 규칙(왼쪽 경계 + 문장부호 <)에 걸려 굵게가 깨지므로 `<span>**나**</span>` 꼴로 쓴다.
 */
export const WikiHtmlSpan = Mark.create({
  name: WIKI_HTML_SPAN,
  excludes: '',
  inclusive: false,

  addAttributes() {
    return { ...SHAPE_ATTRIBUTES }
  },

  parseHTML() {
    return [
      {
        tag: 'span[class],span[style]',
        getAttrs: (el: HTMLElement) => (!el.hasAttribute('data-mtype') && hasShape(el) ? null : false),
      },
    ]
  },

  renderHTML({ mark }) {
    return ['span', { ...renderAttrs(mark.attrs.className, mark.attrs.style), 'data-wiki-html-span': '' }, 0]
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          // 정리 후 속성이 하나도 없으면(Yjs 로 들어온 위험 값뿐) 태그 없이 글자만 쓴다 — 빈 <span> 은 다시 읽을 때 어차피 버려진다.
          open(_state: MarkdownSerializerState, mark: PMMark) {
            const attrs = attrText(mark.attrs.className, mark.attrs.style)
            return attrs ? `<span${attrs}>` : ''
          },
          close(_state: MarkdownSerializerState, mark: PMMark) {
            return hasAttrs(mark.attrs.className, mark.attrs.style) ? '</span>' : ''
          },
        },
        parse: {
          // markdown-it 인라인 HTML(html_inline) → DOM <span> → parseHTML.
        },
      },
    }
  },
})
