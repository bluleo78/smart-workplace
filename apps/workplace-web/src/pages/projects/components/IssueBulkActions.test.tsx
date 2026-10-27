// IssueBulkActions — 일괄 작업 바 가독성(WP-1019). 바탕은 불투명 표면이고(다크 muted 는 흰 5% 알파라 아래 목록 글자가 비쳤다)
// 글자는 회색(muted-foreground)이 아닌 본문색이다. 실제 겹침·대비 픽셀은 라이브 스택 스크린샷으로 확인한다.
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

function renderBar() {
  return renderWithProviders(
    <IssueBulkActions projectKey="WP" selected={new Set([1, 2])} onClear={vi.fn()} onSettled={vi.fn()} />,
  )
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
