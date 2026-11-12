/**
 * 메일 작성기 표(WP-1524) — 받는 쪽 메일 프로그램이 같게 그리는 인라인 style 만 지닌 표.
 *
 * 왜 class·colgroup 을 버리나: Outlook·Gmail 은 우리 앱의 class 스타일시트를 받지 않고, 열 너비용 colgroup·min-width 도
 * 제각각 해석한다. 그래서 표·셀에 16진 테두리·여백 style 만 직접 싣고 cellspacing/cellpadding 으로 기본 간격을 없앤다.
 *
 * 왜 요소를 직접 만드나: 16진 색을 `rgb(...)` 로 바꾸지 않고 그대로 보내려고 domWithRawAttrs 로 속성 문자열을 그대로 싣는다.
 *
 * 노드 이름(table·tableRow·tableHeader·tableCell)은 표준 그대로라 노트 표 명령(wikiTableCommands)이 그대로 돈다.
 */
import { type Editor, mergeAttributes } from '@tiptap/core'
import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'

import { MAIL_CELL_STYLE, MAIL_HEADER_CELL_STYLE, MAIL_TABLE_STYLE } from '@/lib/mailFormat'

import { domWithRawAttrs } from './mailRawAttrs'

/** 표 크기 상한(행·열 각각). */
export const MAIL_TABLE_MAX = 8

/** 표 격자 한 변 최대 칸 수 — dock(512px)은 좁아 6, fill 은 8, 모바일은 390px 폭에 44px 칸 6개. 격자를 쓰는 세 곳이 함께 본다. */
export const MAIL_TABLE_GRID_MAX = { dock: 6, fill: 8, mobile: 6 } as const

/** 표 — 크기 조절 핸들 없음, `<table ...><tbody>…</tbody></table>`(colgroup 없음). */
const MailTable = Table.configure({ resizable: false }).extend({
  renderHTML() {
    const table = domWithRawAttrs('table', { cellspacing: '0', cellpadding: '0', style: MAIL_TABLE_STYLE })
    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    return { dom: table, contentDOM: tbody }
  },
})

/** 셀 요소 만들기 — 병합 속성(colspan·rowspan)은 유지하고 style 만 붙인다. class 는 쓰지 않는다. */
function cellRender(tag: 'td' | 'th', style: string) {
  return ({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) => {
    const rest: Record<string, unknown> = { ...mergeAttributes(HTMLAttributes) }
    delete rest.class
    delete rest.style
    const el = domWithRawAttrs(tag, { ...rest, style })
    return { dom: el, contentDOM: el }
  }
}

const MailTableHeader = TableHeader.extend({ renderHTML: cellRender('th', MAIL_HEADER_CELL_STYLE) })
const MailTableCell = TableCell.extend({ renderHTML: cellRender('td', MAIL_CELL_STYLE) })

/** 작성기에 등록하는 표 확장 묶음. */
export const MAIL_TABLE_EXTENSIONS = [MailTable, TableRow, MailTableHeader, MailTableCell]

/** 표 넣기 — 행·열을 1~8 로 자르고 첫 행을 머리글로 한다. */
export function insertMailTable(editor: Editor, rows: number, cols: number): boolean {
  const clamp = (n: number) => Math.min(MAIL_TABLE_MAX, Math.max(1, Math.round(n) || 1))
  return editor.chain().focus().insertTable({ rows: clamp(rows), cols: clamp(cols), withHeaderRow: true }).run()
}
