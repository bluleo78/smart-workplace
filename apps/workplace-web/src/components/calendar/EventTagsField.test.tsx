// 편집 폼 태그 줄(WP-714) — 붙일 수 있는 일정·Outlook 범주 일정·태그 없는 외부 일정에서 무엇이 보이는지.
// 피커의 데이터 훅은 끊는다(팝오버를 열지 않으니 목록이 필요 없다). 실제 PUT 배선은 E2E(calendar-tags.spec.ts)가 본다.
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../test/renderWithProviders'
import type { CalendarEvent } from '../../types/calendar'
import { EventTagsField } from './EventTagsField'

vi.mock('@/hooks/queries/useCalendarTags', () => ({
  useCalendarTags: () => ({ data: [], isSuccess: true }),
  useCreateCalendarTag: () => ({ mutate: vi.fn(), isPending: false }),
  useSetEventTags: () => ({ mutateAsync: vi.fn() }),
}))

const base: CalendarEvent = {
  id: 5,
  title: '회의',
  description: null,
  startsAt: '2026-06-10T01:00:00Z',
  endsAt: '2026-06-10T02:00:00Z',
  allDay: false,
  location: null,
  color: null,
  calendarId: 1,
  calendarName: '기본',
  effectiveColor: 'blue',
  reminderMinutes: null,
  recurrenceRule: null,
  createdAt: '2026-06-10T01:00:00Z',
  updatedAt: '2026-06-10T01:00:00Z',
}

describe('EventTagsField', () => {
  it('앱 일정이면 태그 칩과 「＋ 태그」가 보이고 Outlook 안내는 없다', () => {
    renderWithProviders(
      <EventTagsField event={{ ...base, tags: [{ id: 1, name: '운영', color: 'amber' }], tagsEditable: true }} />,
    )
    expect(screen.getByTestId('event-detail-tag')).toHaveTextContent('운영')
    expect(screen.getByTestId('calendar-form-tag-add')).toBeInTheDocument()
    expect(screen.queryByText(/Outlook 범주에서 가져온 태그예요/)).not.toBeInTheDocument()
  })

  it('태그가 아직 없는 앱 일정도 「＋ 태그」로 붙일 수 있다', () => {
    renderWithProviders(<EventTagsField event={{ ...base, tags: [], tagsEditable: true }} />)
    expect(screen.getByTestId('calendar-form-tag-add')).toBeInTheDocument()
  })

  it('M365 일정은 칩과 Outlook 범주 안내만 보이고 붙이기 버튼이 없다', () => {
    renderWithProviders(
      <EventTagsField event={{ ...base, tags: [{ id: 2, name: '사내 공유', color: 'violet' }], tagsEditable: false }} />,
    )
    expect(screen.getByTestId('event-detail-tag')).toHaveTextContent('사내 공유')
    expect(screen.queryByTestId('calendar-form-tag-add')).not.toBeInTheDocument()
    expect(screen.getByText('Outlook 범주에서 가져온 태그예요 · Outlook에서 바꿀 수 있어요')).toBeInTheDocument()
  })

  it('붙일 수 없고 태그도 없으면(응답에 태그 필드가 없는 경우 포함) 줄째 숨긴다', () => {
    renderWithProviders(<EventTagsField event={base} />)
    expect(screen.queryByTestId('calendar-form-tags')).not.toBeInTheDocument()
  })
})
