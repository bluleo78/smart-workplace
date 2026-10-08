// 노트 표 노드 — tiptap-markdown 표 직렬화기를 대체해 텍스트 없는 셀 내용을 살린다(WP-299).
//
// 왜 대체하는가: tiptap-markdown@0.8.10 의 표 직렬화기(src/extensions/nodes/table.js)는 셀 문단의
// textContent.trim() 이 비면 셀을 통째로 건너뛴다. 멘션 칩·이미지는 텍스트가 없는 leaf 노드라
// textContent 가 '' 이고, 그 셀이 저장 때마다 빈칸이 됐다. 원본 직렬화기는 패키지가 내보내지 않아
// 감쌀 수 없으므로 같은 출력을 내는 직렬화기를 두고 셀 판정 한 곳만 바꾼다. getMarkdownSpec 은 확장의
// storage.markdown 을 기본 직렬화기 위에 덮으므로 이 하나로 웹 에디터·동기화 서버·병합이 함께 바뀐다.
//
// mention/image 에 leafText 를 주는 방법은 쓰지 않는다 — textContent 를 쓰는 다른 곳(복사 텍스트·빈 문서 판정 등)이
// 모두 바뀌어 이 버그 범위를 넘는다.
import { getHTMLFromFragment } from '@tiptap/core'
import { Table } from '@tiptap/extension-table'
import type { MarkdownSerializerState } from '@tiptap/pm/markdown'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'

/** tiptap-markdown 이 state 에 얹는 표 구간 플래그 — WikiMarkdownText(| 이스케이프)와 hardBreak 직렬화기가 읽는다. */
type TableState = MarkdownSerializerState & { inTable?: boolean }

/** 병합(colspan/rowspan) 셀인지 — GFM 표로 표현할 수 없다. */
function hasSpan(cell: PMNode): boolean {
  return cell.attrs.colspan > 1 || cell.attrs.rowspan > 1
}

/**
 * GFM 파이프 표로 쓸 수 있는지 — 원본과 같은 규칙: 첫 행은 전부 헤더 셀, 본문 행엔 헤더 셀 없음,
 * 병합 셀·여러 블록 셀 없음. 아니면 raw HTML 로 폴백한다(#742).
 */
function isMarkdownSerializable(table: PMNode): boolean {
  const [firstRow, ...bodyRows] = table.content.content
  if (!firstRow) return true
  if (firstRow.content.content.some((c) => c.type.name !== 'tableHeader' || hasSpan(c) || c.childCount > 1)) return false
  return !bodyRows.some((row) =>
    row.content.content.some((c) => c.type.name === 'tableHeader' || hasSpan(c) || c.childCount > 1),
  )
}

/**
 * 셀 문단에 쓸 내용이 있는지 — 원본은 textContent.trim() 만 봤다. 텍스트가 아닌 inline 노드(멘션·이미지)가
 * 하나라도 있으면 쓴다. 공백 텍스트만 있는 셀은 원본처럼 건너뛴다(셀 패딩 공백이 저장본에 남지 않게).
 * hardBreak 뿐인 셀도 렌더하지만 hardBreak 직렬화기가 뒤에 다른 노드가 없으면 아무것도 쓰지 않아 결과는 같다.
 */
function hasCellContent(paragraph: PMNode | null): paragraph is PMNode {
  return !!paragraph && (!!paragraph.textContent.trim() || paragraph.content.content.some((n) => !n.isText))
}

/** tiptap-markdown HTML 폴백의 formatBlock — CommonMark HTML 블록이 되도록 바깥 요소 안쪽을 줄바꿈으로 감싼다. */
function formatBlock(html: string): string {
  const body = new window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  // html 은 getHTMLFromFragment 가 만든 표 요소(래퍼 포함)라 첫 요소가 항상 있다.
  const element = body.firstElementChild!
  element.innerHTML = element.innerHTML.trim() ? `\n${element.innerHTML}\n` : '\n'
  return element.outerHTML
}

/**
 * GFM 으로 못 쓰는 표를 raw HTML 로 쓴다 — tiptap-markdown HTMLNode 직렬화기와 같은 출력.
 * 노트 스키마는 Markdown html 옵션을 항상 켜 둔다(extensions.ts) — 기존 저장본의 HTML 표를 읽어야 해서.
 */
function serializeTableHTML(state: TableState, node: PMNode, parent: PMNode | Fragment): void {
  const html = getHTMLFromFragment(Fragment.from(node), node.type.schema)
  const topLevel = parent instanceof Fragment || parent.type.name === node.type.schema.topNodeType.name
  state.write(topLevel ? formatBlock(html) : html)
  state.closeBlock(node)
}

/** 표 노드 확장 — 스키마·옵션은 @tiptap/extension-table 그대로, 마크다운 직렬화기만 대체한다. */
export const WikiTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: TableState, node: PMNode, parent: PMNode | Fragment) {
          if (!isMarkdownSerializable(node)) {
            serializeTableHTML(state, node, parent)
            return
          }
          state.inTable = true
          node.forEach((row, _p, i) => {
            state.write('| ')
            row.forEach((cell, _q, j) => {
              if (j) state.write(' | ')
              const cellContent = cell.firstChild
              if (hasCellContent(cellContent)) state.renderInline(cellContent)
            })
            state.write(' |')
            state.ensureNewLine()
            if (!i) {
              const delimiterRow = Array(row.childCount).fill('---').join(' | ')
              state.write(`| ${delimiterRow} |`)
              state.ensureNewLine()
            }
          })
          state.closeBlock(node)
          state.inTable = false
        },
        parse: {
          // markdown-it 이 처리한다.
        },
      },
    }
  },
})
