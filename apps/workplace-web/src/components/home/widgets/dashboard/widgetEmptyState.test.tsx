import { screen, within } from '@testing-library/react'
import { Bell } from 'lucide-react'
import { expect, test } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { WidgetEmptyState } from './WidgetEmptyState'

// 대시보드 위젯 공용 빈 상태의 접근성 구조 — 다섯 위젯(대화·메일·알림·내 작업·오늘 일정)이 모두 이 컴포넌트를 쓰므로
// 한곳에서 지킨다(WP-1853 리뷰 후속).
test('라이브 영역(role=status)에는 제목·설명만 담고, CTA 링크는 그 밖에 둔다', () => {
  renderWithProviders(
    <WidgetEmptyState
      icon={Bell}
      title="다 따라잡았어요 🎉"
      description="새로운 알림이 생기면 여기에 모여요"
      cta={{ label: '알림 설정', to: '/settings/notifications' }}
      testId="empty"
    />,
  )
  const empty = screen.getByTestId('empty')
  const live = within(empty).getByRole('status')
  expect(live).toHaveTextContent('다 따라잡았어요 🎉')
  expect(live).toHaveTextContent('새로운 알림이 생기면 여기에 모여요')
  // 링크가 라이브 영역 안에 있으면 빈 상태로 바뀔 때 「알림 설정 →」 링크 글자까지 읽힌다.
  expect(within(live).queryByRole('link')).toBeNull()
  expect(within(empty).getByRole('link', { name: /알림 설정/ })).toHaveAttribute('href', '/settings/notifications')
})
