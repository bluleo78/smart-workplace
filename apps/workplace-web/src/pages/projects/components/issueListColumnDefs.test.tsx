// 이슈 목록 열 정의(WP-270) — 키 → 정의 변환 규칙과 셀 렌더러의 값별 표기.
// 무엇을: 정의 없는 커스텀 필드 키 건너뛰기·열 수·가로 스크롤 하한 조건, 커스텀 필드 유형별·값 없음·구버전 응답(보고자 없음) 표기.
// 왜: E2E 는 SELECT 한 유형과 정의가 있는 경우만 지나간다 — 나머지 분기는 여기서 지킨다. 배선은 issue-list-columns.spec.ts.
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUILTIN_ORDER, DEFAULT_COLUMNS } from '../../../lib/issueListColumns'
import type { FieldType, IssueFieldDef, IssueFieldEntry } from '../../../types/customField'
import type { IssueResponse } from '../../../types/issue'
import {
  buildColumnDefs,
  columnHeadCells,
  hasExtraColumns,
  issueListColumnCount,
  issueListMinWidthRem,
  WIDTH_CLASS,
} from './issueListColumnDefs'

const fieldDef = (id: number, name: string, type: FieldType): IssueFieldDef => ({
  id, projectId: 1, name, type, options: null, position: id, createdAt: '', updatedAt: '',
})
const FIELDS = [fieldDef(7, '고객사', 'MULTI_SELECT'), fieldDef(8, '공수', 'NUMBER'), fieldDef(9, '계약일', 'DATE')]

// 셀 렌더에 필요한 필드만 채운 이슈 — 나머지는 셀 렌더러가 읽지 않는다.
const issue = (over: Partial<IssueResponse> = {}): IssueResponse =>
  ({
    number: 1, status: 'TODO', priority: 'MID', dueDate: null, startDate: null, closedAt: null,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    assignees: [], customFields: [], ...over,
  }) as IssueResponse

/** 한 열의 셀 텍스트 — 정의를 만들고 셀 렌더러 결과를 그린다. */
function cellText(key: Parameters<typeof buildColumnDefs>[0][number], it: IssueResponse): string {
  const [def] = buildColumnDefs([key], FIELDS)
  const { container } = render(<>{def.cell(it, { projectKey: 'WP' })}</>)
  return container.textContent ?? ''
}

const entry = (defId: number, type: FieldType, value: unknown): IssueFieldEntry => ({ defId, name: '', type, value })

describe('buildColumnDefs', () => {
  it('정의 없는 커스텀 필드 키(cf99)는 건너뛰고 나머지 순서를 유지한다', () => {
    const defs = buildColumnDefs(['priority', 'cf99', 'due', 'cf8'], FIELDS)
    expect(defs.map((d) => d.key)).toEqual(['priority', 'due', 'cf8'])
    expect(defs.map((d) => d.header)).toEqual(['우선순위', '마감', '공수'])
    // 우선순위만 ID 왼쪽.
    expect(defs.map((d) => d.side)).toEqual(['left', 'right', 'right'])
  })

  it('열 수 = 고정 5칸 + 선택 열', () => {
    expect(issueListColumnCount(buildColumnDefs([], FIELDS))).toBe(5)
    expect(issueListColumnCount(buildColumnDefs(DEFAULT_COLUMNS, FIELDS))).toBe(8)
  })

  it('기본 열 구성이면 제목 하한·가로 스크롤 하한을 걸지 않고, 기본 밖의 열이 켜지면 건다', () => {
    const base = buildColumnDefs(DEFAULT_COLUMNS, FIELDS)
    expect(hasExtraColumns(base)).toBe(false)
    expect(issueListMinWidthRem(base)).toBeNull()
    const withClosed = buildColumnDefs([...DEFAULT_COLUMNS, 'closed'], FIELDS)
    expect(hasExtraColumns(withClosed)).toBe(true)
    expect(issueListMinWidthRem(withClosed)).toBeGreaterThan(0)
  })
})

describe('열 폭', () => {
  // 폭의 원천은 rem 하나 — 클래스 표(WIDTH_CLASS)가 rem 과 어긋나면 헤더 칸 폭과 가로 스크롤 하한(rem 합)이 갈라진다.
  it('폭 클래스는 rem 과 같은 Tailwind 폭(1 단위 = 0.25rem)이다', () => {
    for (const [rem, cls] of Object.entries(WIDTH_CLASS)) {
      const n = Number(rem) * 4
      expect(cls).toBe(`w-${n}`)
    }
  })

  it('모든 내장 열과 커스텀 필드 열의 폭은 클래스 표에 있다', () => {
    const defs = buildColumnDefs([...BUILTIN_ORDER, 'cf8'], FIELDS)
    expect(defs).toHaveLength(BUILTIN_ORDER.length + 1)
    for (const d of defs) expect(WIDTH_CLASS[d.widthRem]).toBeDefined()
  })

  // 칸 폭은 머리 행이 정한다(table-fixed, WP-1143) — 셀 톤(cellClass)에 폭 상한(max-w-*)을 다시 걸면 표 칸 max-width 의 브라우저 차이에 다시 기댄다.
  it('셀 톤(cellClass)에는 폭 상한이 없다', () => {
    const defs = buildColumnDefs([...BUILTIN_ORDER, 'cf7', 'cf8', 'cf9'], FIELDS)
    for (const d of defs) expect(d.cellClass?.(issue()) ?? '', d.key).not.toMatch(/\bmax-w-/)
  })

  // 긴 필드 이름(띄어쓰기 없음)이 칸을 넘지 않게 머리 글자는 말줄임하고 툴팁에 전체를 싣는다. 아이콘 열·숨긴 머리는 스크린리더 전용.
  it('머리 칸은 이름을 말줄임하고 커스텀 필드 머리만 툴팁에 전체를 싣는다, 아이콘 열·숨긴 머리는 sr-only', () => {
    const long = '아주긴커스텀필드이름이띄어쓰기없이이어진다'
    const defs = buildColumnDefs(['priority', 'due', 'cf8'], [fieldDef(8, long, 'TEXT')])
    const { container } = render(<table><thead><tr>{columnHeadCells(defs)}</tr></thead></table>)
    const [prio, due, cf] = container.querySelectorAll('th span')
    expect(prio.className).toBe('sr-only')
    expect(due.className).toContain('truncate')
    expect(due.getAttribute('title')).toBeNull()
    expect(cf.className).toContain('truncate')
    expect(cf.getAttribute('title')).toBe(long)
    const hidden = render(<table><thead><tr>{columnHeadCells(defs, { hideLabel: true })}</tr></thead></table>)
    for (const s of hidden.container.querySelectorAll('th span')) {
      expect(s.className).toBe('sr-only')
      expect(s.getAttribute('title')).toBeNull()
    }
  })

  it('가로 스크롤 하한 = 고정 열 29.5rem(체크·상태 2.25·ID 7·제목 16·⋯ 2) + 선택 열 폭 합', () => {
    // 기본 열(우선순위 2.25·담당자 5·마감 8) + 완료일 8.
    expect(issueListMinWidthRem(buildColumnDefs([...DEFAULT_COLUMNS, 'closed'], FIELDS))).toBe(29.5 + 2.25 + 5 + 8 + 8)
  })
})

describe('셀 렌더러', () => {
  beforeEach(() => {
    // 같은 해면 연도 생략 — 「올해」 기준을 고정한다.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T06:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  // WP-1080: 정지된 담당자는 아바타만 보이는 목록 칸에서도 흐리게 + 접근 이름 「(비활성)」 로 다른 담당자와 구분된다.
  it('담당자 칸 — 정지된 담당자 아바타만 비활성으로 표시한다', () => {
    const [def] = buildColumnDefs(['assignee'], FIELDS)
    const it = issue({
      assignees: [
        { id: 1, username: 'kim', name: '김', kind: 'HUMAN', active: true },
        { id: 2, username: 'park', name: '박', kind: 'HUMAN', active: false },
      ],
    })
    const { getByTestId } = render(<>{def.cell(it, { projectKey: 'WP' })}</>)
    expect(getByTestId('user-avatar-1')).not.toHaveAttribute('data-inactive')
    expect(getByTestId('user-avatar-1')).toHaveAccessibleName('김')
    expect(getByTestId('user-avatar-2')).toHaveAttribute('data-inactive', 'true')
    expect(getByTestId('user-avatar-2')).toHaveAccessibleName('박 (비활성)')
  })

  it('다중 선택은 첫 값 + `+N`', () => {
    expect(cellText('cf7', issue({ customFields: [entry(7, 'MULTI_SELECT', ['A', 'B', 'C'])] }))).toBe('A +2')
  })

  it('날짜 커스텀 필드는 같은 해면 「10월 16일」, 숫자는 값 그대로', () => {
    expect(cellText('cf9', issue({ customFields: [entry(9, 'DATE', '2026-10-16')] }))).toBe('10월 16일')
    expect(cellText('cf8', issue({ customFields: [entry(8, 'NUMBER', 12.5)] }))).toBe('12.5')
  })

  it('값이 없거나 빈 값이면 「—」', () => {
    expect(cellText('cf8', issue())).toBe('—')
    expect(cellText('cf7', issue({ customFields: [entry(7, 'MULTI_SELECT', [])] }))).toBe('—')
    expect(cellText('milestone', issue())).toBe('—')
    expect(cellText('cycle', issue())).toBe('—')
    expect(cellText('due', issue())).toBe('—')
  })

  it('구성요소 — 칩 2개 + 「+N」, 없거나 구버전 응답이면 「—」(WP-933)', () => {
    const comps = [
      { id: 1, name: 'Compute', archived: false },
      { id: 2, name: 'Storage', archived: false },
      { id: 3, name: 'Old', archived: true },
    ]
    expect(cellText('components', issue({ components: comps }))).toBe('ComputeStorage+1')
    expect(cellText('components', issue({ components: [] }))).toBe('—')
    expect(cellText('components', issue({ components: undefined }))).toBe('—')
  })

  it('구버전 응답(보고자·사이클 필드 없음)이면 「—」', () => {
    expect(cellText('reporter', issue({ reporter: undefined }))).toBe('—')
    expect(cellText('cycle', issue({ cycles: undefined }))).toBe('—')
  })

  it('완료일 — 끝나지 않았거나 closedAt 이 없으면 「—」, 취소는 ⊘', () => {
    expect(cellText('closed', issue({ status: 'DONE', closedAt: null }))).toBe('—')
    expect(cellText('closed', issue({ status: 'CANCELED', closedAt: '2026-10-18T01:00:00Z' }))).toBe('⊘ 10월 18일')
  })
})
