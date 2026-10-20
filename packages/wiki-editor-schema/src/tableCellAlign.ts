// 노트 표 셀 가로 정렬(WP-584) — 셀·헤더 노드에 align 속성을 더한다.
//
// 저장은 마크다운 GFM 표의 열 정렬 마커(`:---:` 등)라 정렬 단위는 열이다. 직렬화기(tableNode.ts)는 첫 행(헤더) 셀의 값을
// 그 열의 마커로 쓰고, 같은 열의 셀이 늘 헤더와 같은 값을 갖도록 tableNode.ts 의 열 정렬 맞춤 플러그인이 문서가 바뀔 때마다 맞춘다.
// 읽을 때는 markdown-it 이 마커를 셀마다 style="text-align:…" 으로 풀어 주므로 parseHTML 이 그 style 을 읽는다.
// 'left' 는 따로 두지 않는다 — 정렬 없음(`---`)이 화면에서 왼쪽이고, 예전 저장본도 정렬 없이 저장돼 왔다.
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'

/** 저장되는 정렬 값 — null 은 기본(왼쪽). */
export type WikiCellAlign = 'center' | 'right' | null

/** HTML 의 text-align(또는 옛 align 속성) 값을 저장 값으로 — center/right 만 남기고 나머지는 기본(null). */
export function parseCellAlign(value: string | null | undefined): WikiCellAlign {
  const v = value?.trim().toLowerCase()
  return v === 'center' || v === 'right' ? v : null
}

/** 셀·헤더 공통 align 속성 정의. */
const alignAttribute = {
  align: {
    default: null as WikiCellAlign,
    parseHTML: (el: HTMLElement) => parseCellAlign(el.style.textAlign || el.getAttribute('align')),
    renderHTML: (attrs: { align?: WikiCellAlign }) => (attrs.align ? { style: `text-align: ${attrs.align}` } : {}),
  },
}

/** 정렬 속성을 더한 본문 셀. */
export const WikiTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttribute }
  },
})

/** 정렬 속성을 더한 헤더 셀. */
export const WikiTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttribute }
  },
})
