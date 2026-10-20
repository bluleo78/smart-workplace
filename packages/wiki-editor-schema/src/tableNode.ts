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
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { Mapping } from '@tiptap/pm/transform'

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

/** 열 정렬 값 → GFM 구분 행 마커. 기본(왼쪽)은 정렬 없음(`---`)으로 쓴다 — tableCellAlign.ts 참조. */
function delimiterOf(align: unknown): string {
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  return '---'
}

/**
 * 열 정렬 맞춤(WP-584) — GFM 으로 저장되는 표는 열마다 헤더 셀의 align 을 그 열의 모든 셀에 맞춘다.
 *
 * 왜: 저장은 헤더 셀 값 하나(열 마커)뿐인데, 행 추가(prosemirror-tables addRow 는 빈 셀을 align=null 로 만든다)·붙여넣기·동시 편집은
 * 열 안의 값을 어긋나게 둔다. 그러면 화면은 왼쪽인데 저장본은 가운데처럼 보이는 것과 저장되는 것이 갈린다. 표 명령마다 고치는 대신 문서가 바뀔 때마다
 * 한곳에서 맞춘다. 마크다운으로 못 쓰는(HTML 로 저장되는) 표는 셀마다 style 로 남으므로 건드리지 않는다.
 * 같은 값을 여러 접속자가 동시에 넣어도 결과가 같아(멱등) 동시 편집에서 다투지 않는다. 남이 보낸 변경도 맞춘다 — 행 추가와 열 정렬이
 * 동시에 일어나면 어느 쪽도 자기 변경만으로는 어긋남을 볼 수 없다.
 */
const columnAlignSync = new Plugin({
  key: new PluginKey('wikiTableColumnAlign'),
  appendTransaction(transactions, _old, state) {
    if (!transactions.some((t) => t.docChanged)) return null
    const tr = state.tr
    // 이번에 바뀐 범위에 걸친 표만 본다 — 입력마다 문서 전체를 훑지 않게. nodesBetween 은 범위를 감싼 조상(표)도 방문한다.
    const seen = new Set<number>()
    for (const [from, to] of changedRanges(transactions, state.doc.content.size)) {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'table') return !node.isTextblock
        if (!seen.has(pos)) {
          seen.add(pos)
          syncColumnAligns(tr, node, pos)
        }
        return false
      })
    }
    return tr.docChanged ? tr : null
  },
})

/** 트랜잭션들이 바꾼 범위를 마지막 문서 좌표로 — 각 단계의 새 범위(속성만 바꾼 단계는 그 노드)를 뒤 단계들의 매핑으로 옮긴다. */
function changedRanges(transactions: readonly Transaction[], docSize: number): [number, number][] {
  const maps = transactions.flatMap((t) => t.mapping.maps)
  const steps = transactions.flatMap((t) => t.steps)
  const ranges: [number, number][] = []
  steps.forEach((step, i) => {
    const rest = new Mapping(maps.slice(i + 1))
    const push = (from: number, to: number) =>
      ranges.push([Math.min(rest.map(from, -1), docSize), Math.min(rest.map(to, 1), docSize)])
    maps[i].forEach((_os, _oe, from, to) => push(from, to))
    // 속성만 바꾸는 단계(AttrStep)는 위치 매핑이 비어 있어 따로 넣는다.
    const attrPos = (step as { pos?: number }).pos
    if (typeof attrPos === 'number') push(attrPos, attrPos + 1)
  })
  return ranges
}

/** GFM 으로 저장되는 표의 열마다 헤더 셀 align 을 본문 셀에 맞춘다. 표 위치(tablePos) 기준으로 TableMap 의 셀 위치를 쓴다. */
function syncColumnAligns(tr: Transaction, table: PMNode, tablePos: number): void {
  if (!isMarkdownSerializable(table)) return
  const map = TableMap.get(table)
  for (let col = 0; col < map.width; col++) {
    const want = table.nodeAt(map.map[col])!.attrs.align
    for (let row = 1; row < map.height; row++) {
      const cellPos = map.map[row * map.width + col]
      const cell = table.nodeAt(cellPos)!
      if (cell.attrs.align !== want) tr.setNodeMarkup(tablePos + 1 + cellPos, null, { ...cell.attrs, align: want })
    }
  }
}

/** 표 노드 확장 — 스키마·옵션은 @tiptap/extension-table 그대로, 마크다운 직렬화기만 대체하고 열 정렬 맞춤을 더한다. */
export const WikiTable = Table.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), columnAlignSync]
  },
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
              // 열 정렬(WP-584) — 첫 행 셀의 align 이 그 열의 마커다(에디터 명령이 열 전체를 같은 값으로 맞춘다).
              const delimiterRow = row.content.content.map((cell) => delimiterOf(cell.attrs.align)).join(' | ')
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
