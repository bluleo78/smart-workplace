// 노트 에디터 표 명령의 단일 원천. 툴바·우클릭 메뉴·단축키 세 소비자가 모두 이 배열에서
// 파생하므로, 세 경로가 서로 다른 명령 집합으로 갈라지는 일이 구조적으로 생기지 않는다.
//
// 명령 집합이 7개뿐인 이유는 마크다운 직렬화 제약이다. tiptap-markdown 은 (1) 첫 행 전체가
// 헤더이고 (2) 병합 셀이 없고 (3) 셀마다 문단이 1개일 때만 GFM 표로 저장하고, 하나라도
// 어기면 표 전체를 raw HTML 로 뱉는다. 따라서 병합·헤더 토글은 "눌리는데 저장이 안 되는"
// 기능이 되므로 넣지 않는다. 가로 정렬은 직렬화기가 GFM 열 정렬 마커(`:---:`)를 쓰도록 바꿔
// 열 단위로만 제공한다(WP-584, 아래 WIKI_TABLE_ALIGNS — 셀 단위는 마크다운으로 저장할 수 없다).
// 행/열 이동은 @tiptap/extension-table 에 명령 자체가 없다.
import type { WikiCellAlign } from '@smart-workplace/wiki-editor-schema'
import type { Editor } from '@tiptap/core'
import { isInTable, selectedRect } from '@tiptap/pm/tables'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  type LucideIcon,
  Rows3,
  Trash2,
} from 'lucide-react'

export type WikiTableCommandKey =
  | 'addRowBefore'
  | 'addRowAfter'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable'

export interface WikiTableCommand {
  key: WikiTableCommandKey
  /** 툴바 aria-label 과 우클릭 메뉴 라벨에 공통 사용. */
  label: string
  icon: LucideIcon
  /** true 면 파괴적 동작 — 메뉴에서 구분선 뒤로 묶고 destructive 색을 쓴다. */
  destructive: boolean
}

export const WIKI_TABLE_COMMANDS: readonly WikiTableCommand[] = [
  { key: 'addRowBefore', label: '위에 행 삽입', icon: ArrowUpToLine, destructive: false },
  { key: 'addRowAfter', label: '아래에 행 삽입', icon: ArrowDownToLine, destructive: false },
  { key: 'addColumnBefore', label: '왼쪽에 열 삽입', icon: ArrowLeftToLine, destructive: false },
  { key: 'addColumnAfter', label: '오른쪽에 열 삽입', icon: ArrowRightToLine, destructive: false },
  // 삭제 3종은 굳이 아이콘을 다르게 쓴다: destructive 색만으로는 툴바에서 인접한 세 버튼이
  // 픽셀 단위로 동일해 보여 구분이 안 된다(그중 '표 삭제'가 가장 파괴적). 형태로 대상을,
  // 색으로 파괴성 계층을 나타낸다.
  { key: 'deleteRow', label: '행 삭제', icon: Rows3, destructive: true },
  { key: 'deleteColumn', label: '열 삭제', icon: Columns3, destructive: true },
  { key: 'deleteTable', label: '표 삭제', icon: Trash2, destructive: true },
] as const

/** 툴바·우클릭 메뉴 묶음 — 삽입(일반) | 열 정렬 | 삭제(파괴적) 순으로 그린다. */
export const INSERT_TABLE_COMMANDS = WIKI_TABLE_COMMANDS.filter((c) => !c.destructive)
export const DESTRUCTIVE_TABLE_COMMANDS = WIKI_TABLE_COMMANDS.filter((c) => c.destructive)

/** 열 가로 정렬 선택지(WP-584) — 툴바·우클릭 메뉴가 함께 쓴다. 왼쪽은 정렬 없음(null)과 같다. key 는 React key·testid 용. */
export interface WikiTableAlign {
  key: 'left' | 'center' | 'right'
  value: WikiCellAlign
  label: string
  icon: LucideIcon
}

export const WIKI_TABLE_ALIGNS: readonly WikiTableAlign[] = [
  { key: 'left', value: null, label: '왼쪽 정렬', icon: AlignLeft },
  { key: 'center', value: 'center', label: '가운데 정렬', icon: AlignCenter },
  { key: 'right', value: 'right', label: '오른쪽 정렬', icon: AlignRight },
] as const

/** 가드 판정에 필요한 표 상태만 뽑은 스냅샷. 에디터 없이 단위 테스트 가능하게 하려는 분리다. */
export interface WikiTableSnapshot {
  inTable: boolean
  inHeaderRow: boolean
  columnCount: number
  rowCount: number
  /** 커서(또는 고른 셀 중 첫) 열의 정렬 — 툴바·메뉴의 현재 정렬 표시용. */
  columnAlign: WikiCellAlign
}

const EMPTY_SNAPSHOT: WikiTableSnapshot = {
  inTable: false,
  inHeaderRow: false,
  columnCount: 0,
  rowCount: 0,
  columnAlign: null,
}

/** 명령 활성 여부 — 순수 함수. 두 가드가 핵심이다:
 *  헤더 행 삭제 금지(헤더가 사라지면 GFM 표로 저장되지 않는다),
 *  마지막 열 삭제 금지(열 0개짜리 표가 남는다 — 지우려면 '표 삭제'). */
export function isTableCommandEnabled(
  key: WikiTableCommandKey,
  snap: WikiTableSnapshot,
): boolean {
  if (!snap.inTable) return false
  if (key === 'deleteRow') return !snap.inHeaderRow
  if (key === 'deleteColumn') return snap.columnCount > 1
  return true
}

/** 현재 선택 위치에서 표 스냅샷을 읽는다. 표 밖이면 inTable=false.
 *  행 인덱스는 노드 동일성이 아니라 $from.index(depth) 로 구한다(같은 내용의 행이
 *  여러 개일 때 노드 비교는 신뢰할 수 없다). */
export function readTableSnapshot(editor: Editor | null): WikiTableSnapshot {
  if (!editor) return EMPTY_SNAPSHOT
  const { $from } = editor.state.selection
  // 표까지 올라가는 길에 지나는 셀 — 커서 셀(여러 셀 선택이면 문서 순 첫 셀)이고, 같은 열은 늘 같은 정렬이라 그 값을 쓴다.
  let cellAlign: WikiCellAlign = null
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') cellAlign = node.attrs.align
    if (node.type.name !== 'table') continue
    const firstRow = node.firstChild
    return {
      inTable: true,
      inHeaderRow: $from.index(depth) === 0,
      columnCount: firstRow?.childCount ?? 0,
      rowCount: node.childCount,
      columnAlign: cellAlign,
    }
  }
  return EMPTY_SNAPSHOT
}

/** 명령 실행. 키 이름이 tiptap 명령 이름과 1:1 이라 분기 없이 위임한다.
 *  호출부(툴바/메뉴/단축키)도 isTableCommandEnabled 로 disabled 를 미리 칠하지만,
 *  그 disabled 는 React 렌더 시점 스냅샷이고 갱신은 비동기 selectionUpdate 미러에 의존한다.
 *  커서가 본문 행 → 헤더 행으로 옮겨간 직후, 리렌더 전 프레임에 '행 삭제'가 눌리면
 *  헤더 행이 지워져 표 전체가 raw HTML 로 저장되는 사고가 난다. 실행 지점에서 한 번 더
 *  막아 그 경합 창을 없앤다. */
export function runTableCommand(editor: Editor, key: WikiTableCommandKey): void {
  if (!isTableCommandEnabled(key, readTableSnapshot(editor))) return
  editor.chain().focus()[key]().run()
}

/**
 * 열 정렬 적용(WP-584) — 커서가 있는 열, 여러 셀을 골랐으면 고른 셀이 걸친 열들의 셀 전체에 같은 값을 넣는다.
 * 마크다운 표는 열 단위 정렬만 저장하므로(구분 행 `:---:`) 셀 하나만 바꾸지 않는다. 마크다운 표는 스키마 패키지의 열 정렬 맞춤이
 * 헤더 값을 퍼뜨리지만, HTML 로 저장되는 표(병합 셀 등)는 맞춤 대상이 아니라 열 전체를 여기서 직접 바꾼다.
 */
export function setTableColumnAlign(editor: Editor, align: WikiCellAlign): void {
  if (!isInTable(editor.state)) return
  const rect = selectedRect(editor.state)
  const tr = editor.state.tr
  // 고른 열들의 맨 위부터 맨 아래까지 — cellsInRect 가 병합 셀을 한 번씩만 돌려준다.
  for (const pos of rect.map.cellsInRect({ left: rect.left, right: rect.right, top: 0, bottom: rect.map.height })) {
    const cell = rect.table.nodeAt(pos)
    if (cell && cell.attrs.align !== align) tr.setNodeMarkup(rect.tableStart + pos, null, { ...cell.attrs, align })
  }
  if (tr.docChanged) editor.view.dispatch(tr)
  editor.commands.focus()
}

/** 커서가 속한 표 DOM 의 뷰포트 사각형. 툴바를 셀이 아니라 표 상단에 앵커하기 위해 쓴다.
 *  renderWrapper(#754) 로 div.tableWrapper > table 구조가 되므로 래퍼가 있으면 래퍼를 쓴다 —
 *  가로 스크롤이 걸린 넓은 표는 table 사각형이 뷰포트를 한참 넘어가서, 그 중앙에 앵커하면
 *  툴바가 화면 밖으로 밀린다. 래퍼는 항상 본문 폭이라 안전하다. */
export function readTableRect(editor: Editor | null): DOMRect | null {
  if (!editor) return null
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'table') continue
    const dom = editor.view.nodeDOM($from.before(depth))
    if (!(dom instanceof HTMLElement)) return null
    // dom 은 renderWrapper 가 켜져 있으면 래퍼 div, 아니면 table 자체다.
    return dom.getBoundingClientRect()
  }
  return null
}
