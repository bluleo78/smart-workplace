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

// 디자인 시스템 06 §B 빈 상태 규격(WP-1939) — 아이콘 40px muted(AI 강조색 아님), 제목 14px/500, 본문 12px muted.
test('아이콘·제목·설명이 빈 상태 규격 클래스를 쓴다', () => {
  renderWithProviders(
    <WidgetEmptyState
      icon={Bell}
      title="다 따라잡았어요"
      description="새로운 알림이 생기면 여기에 모여요"
      cta={{ label: '알림 설정', to: '/settings/notifications' }}
      testId="empty"
    />,
  )
  const empty = screen.getByTestId('empty')
  const icon = empty.querySelector('svg')
  expect(icon).toHaveClass('h-10', 'w-10', 'text-muted-foreground')
  expect(icon).not.toHaveClass('text-ai-accent')
  const live = within(empty).getByRole('status')
  expect(within(live).getByText('다 따라잡았어요')).toHaveClass('text-sm', 'font-medium')
  expect(within(live).getByText('새로운 알림이 생기면 여기에 모여요')).toHaveClass('text-xs', 'text-muted-foreground')
})

// 긍정 빈 상태(할 일 없음 = 다 끝냄)는 tone="positive" 로 체크 아이콘만 primary 로 바꾼다 — muted 는 빠진다.
test('tone="positive" 면 아이콘이 primary 색이고 muted 가 아니다', () => {
  renderWithProviders(
    <WidgetEmptyState
      icon={Bell}
      title="지금 손댈 일이 없어요"
      description="담당한 작업을 모두 끝냈어요"
      cta={{ label: '새 이슈', to: '/projects' }}
      testId="empty"
      tone="positive"
    />,
  )
  const icon = screen.getByTestId('empty').querySelector('svg')
  expect(icon).toHaveClass('h-10', 'w-10', 'text-primary')
  expect(icon).not.toHaveClass('text-muted-foreground')
})
