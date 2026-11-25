// 모바일 에픽 시트 — 진행 중 사이클 소속 종료 에픽의 제목 흐림·삭선과 선택 시 전경색 복원(WP-2101).
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { MobileEpicChip } from './MobileEpicSheet'

const epic = (number: number, title: string, status: string) => ({
  id: number,
  number,
  title,
  status,
  childCount: 0,
  childDoneCount: 0,
  color: null,
})

vi.mock('../../../../hooks/queries/useProjectEpics', () => ({
  usePanelEpics: () => ({
    epicType: { id: 9 },
    epics: [epic(1, '열린 에픽', 'TODO'), epic(2, '취소된 에픽', 'CANCELED')],
  }),
  useClosedEpics: () => ({ epics: [], loadError: false, retry: () => {} }),
}))

test('선택 안 된 취소 에픽은 흐리고 삭선, 선택하면 전경색이 되고 흐림이 빠진다(삭선은 유지)', async () => {
  const user = userEvent.setup()
  renderWithProviders(<MobileEpicChip projectKey="WP" canCreateIssue={false} />)
  await user.click(screen.getByTestId('mobile-chip-epic'))

  const before = screen.getByText('취소된 에픽')
  expect(before).toHaveClass('line-through', 'text-muted-foreground')
  expect(screen.getByText('열린 에픽')).not.toHaveClass('text-muted-foreground')

  await user.click(before)
  // 고르면 시트가 닫히므로 칩으로 다시 연다.
  await user.click(screen.getByTestId('mobile-chip-epic'))
  const after = screen.getByText('취소된 에픽')
  expect(after).toHaveClass('text-foreground', 'line-through')
  expect(after).not.toHaveClass('text-muted-foreground')
})
