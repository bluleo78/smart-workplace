// IssueBulkActions — 일괄 작업 바 가독성(WP-1019). 바탕은 불투명 표면이고(다크 muted 는 흰 5% 알파라 아래 목록 글자가 비쳤다)
// 글자는 회색(muted-foreground)이 아닌 본문색이다. 실제 겹침·대비 픽셀은 라이브 스택 스크린샷으로 확인한다.
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HIDE_SCROLLBAR } from '@/lib/scrollStyles'
import { renderWithProviders } from '@/test/renderWithProviders'

import { IssueBulkActions } from './IssueBulkActions'

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('../../../hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }))
vi.mock('../../../hooks/queries/useProjectMembers', () => ({ useProjectMembers: () => ({ data: [] }) }))
vi.mock('../../../hooks/queries/useProjectStatuses', () => ({ useProjectStatusList: () => [] }))
vi.mock('../../../hooks/queries/useBulkIssueActions', () => ({
  useBulkAssign: () => ({ mutate: vi.fn() }),
  useBulkDeleteIssues: () => ({ mutate: vi.fn() }),
  useBulkUpdateStatus: () => ({ mutate: vi.fn() }),
}))

function bar(selected: Set<number>) {
  return <IssueBulkActions projectKey="WP" selected={selected} onClear={vi.fn()} onSettled={vi.fn()} />
}

function renderBar(selected = new Set([1, 2])) {
  return renderWithProviders(bar(selected))
}

describe('IssueBulkActions — 가독성 (WP-1019)', () => {
  it.each([
    ['데스크톱', false],
    ['모바일', true],
  ])('%s: 바탕은 불투명 popover 표면이고 조작 글자는 회색이 아니다', (_name, isMobile) => {
    mobile.value = isMobile
    renderBar()

    const bar = screen.getByTestId('issue-bulk-toolbar')
    expect(bar).toHaveClass('bg-popover')
    // 반투명 바탕(muted·muted/NN·background/NN 등)은 아래 목록 글자가 비친다.
    expect(bar.className).not.toMatch(/bg-(muted|card)\b|bg-\w+\/\d+|backdrop-blur/)
    for (const id of ['bulk-status-trigger', 'bulk-assignee-trigger']) {
      expect(screen.getByTestId(id)).toHaveClass('text-foreground')
      expect(screen.getByTestId(id)).not.toHaveClass('text-muted-foreground')
    }
    expect(screen.getByTestId('bulk-clear')).not.toHaveClass('text-muted-foreground')
  })
})

// WP-2070 — 데스크톱 바는 한 줄을 지킨다. 글자가 접혀 바가 커지면(약 58px) 슬롯의 scroll-pt-11(44px) 여백을 넘어
// Shift+Tab 초점이 다시 바 뒤로 가려진다. 넘친 단추는 바 안 가로 스크롤(스크롤바 숨김 — 클래식 스크롤바가 높이를 늘리지 않게)로 담는다.
// 실제 좁은 폭에서 단추가 바 안에 보이는지는 E2E(issue-list-cycle-group.spec.ts)가 잰다. 모바일 바(고정 하단 바)의 모양은 바꾸지 않는다.
describe('IssueBulkActions — 데스크톱 바 한 줄·바 안 가로 스크롤 (WP-2070)', () => {
  it.each([
    ['데스크톱', false, true],
    ['모바일', true, false],
  ])('%s: whitespace-nowrap·overflow-x-auto·스크롤바 숨김 여부', (_name, isMobile, desktop) => {
    mobile.value = isMobile
    renderBar()
    const bar = screen.getByTestId('issue-bulk-toolbar')
    for (const cls of ['whitespace-nowrap', 'overflow-x-auto', HIDE_SCROLLBAR]) {
      if (desktop) expect(bar).toHaveClass(cls)
      else expect(bar).not.toHaveClass(cls)
    }
  })
})

// WP-2065 — 바는 이름 있는 group(「일괄 작업」)이고, 선택 개수는 바 밖의 늘 마운트된 status 영역(ResultStatus)이 알린다.
describe('IssueBulkActions — 스크린리더 안내 (WP-2065)', () => {
  it.each([
    ['데스크톱', false],
    ['모바일', true],
  ])('%s: 바는 이름이 「일괄 작업」인 group 이다', (_name, isMobile) => {
    mobile.value = isMobile
    renderBar()
    expect(screen.getByRole('group', { name: '일괄 작업' })).toBe(screen.getByTestId('issue-bulk-toolbar'))
  })

  it('선택 개수가 바뀔 때마다 바 밖 status 영역이 알리고, 처음·선택 해제에는 비어 있다', async () => {
    mobile.value = false
    const { rerender } = renderBar(new Set())
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('data-testid', 'issue-bulk-status')
    // 처음(선택 없음)에는 아무것도 읽히지 않는다.
    expect(screen.queryByTestId('issue-bulk-toolbar')).toBeNull()
    expect(status).toHaveTextContent(/^$/)

    rerender(bar(new Set([1])))
    await waitFor(() => expect(status).toHaveTextContent('선택 1개, 일괄 작업 사용 가능'))
    // 영역은 바와 함께 생기지 않는다 — 바 밖에 그대로 있다.
    expect(screen.getByTestId('issue-bulk-toolbar').contains(status)).toBe(false)

    rerender(bar(new Set([1, 2, 3])))
    await waitFor(() => expect(status).toHaveTextContent('선택 3개, 일괄 작업 사용 가능'))

    rerender(bar(new Set()))
    expect(screen.queryByTestId('issue-bulk-toolbar')).toBeNull()
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent(/^$/)
  })
})
