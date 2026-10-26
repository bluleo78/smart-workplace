// 일정 폼 태그 줄(WP-714, 일정 편집 폼 배치 B) — 붙일 수 있는 일정·Outlook 범주 일정·태그 없는 외부 일정에서 무엇이 보이는지,
// 그리고 폼 상태라 체크가 저장(PUT)이 아니라 onChange 로만 가는지. 일정 저장(POST·PATCH)에 tagIds 가 함께 실리는 흐름은 src/pages/calendar/calendarTags.test.tsx 가 본다.
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TAG_HINT_OUTLOOK_EVENT, TAG_HINT_OUTLOOK_READ_ONLY } from '@/lib/calendarTag'

import { renderWithProviders } from '../../test/renderWithProviders'
import { EventTagsField } from './EventTagsField'

const mutateAsync = vi.fn()

vi.mock('@/hooks/queries/useCalendarTags', () => ({
  useCalendarTags: () => ({
    data: [
      { id: 1, name: '운영', color: 'amber', eventCount: 0, hasFeed: false, fromOutlook: false },
      { id: 2, name: '사내 공유', color: 'violet', eventCount: 0, hasFeed: false, fromOutlook: true },
    ],
    isSuccess: true,
  }),
  useCreateCalendarTag: () => ({ mutate: vi.fn(), isPending: false }),
  useSetEventTags: () => ({ mutateAsync }),
}))

const ops = { id: 1, name: '운영', color: 'amber' }
const shared = { id: 2, name: '사내 공유', color: 'violet' }

describe('EventTagsField', () => {
  it('붙일 수 있으면 태그 칩과 「＋ 태그」가 보이고, 안내가 없으면 안내 줄도 없다', () => {
    renderWithProviders(<EventTagsField value={[ops]} onChange={vi.fn()} editable hint={null} />)
    expect(screen.getByTestId('event-detail-tag')).toHaveTextContent('운영')
    expect(screen.getByTestId('calendar-form-tag-add')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-form-tags-hint')).not.toBeInTheDocument()
  })

  it('태그가 아직 없어도(새 일정 포함) 「＋ 태그」로 고를 수 있다', () => {
    renderWithProviders(<EventTagsField value={[]} onChange={vi.fn()} editable hint={null} />)
    expect(screen.getByTestId('calendar-form-tag-add')).toBeInTheDocument()
  })

  it('붙일 수 있는 M365 일정은 「Outlook 범주에도 반영」 안내가 함께 보인다 (WP-716)', () => {
    renderWithProviders(<EventTagsField value={[shared]} onChange={vi.fn()} editable hint={TAG_HINT_OUTLOOK_EVENT} />)
    expect(screen.getByTestId('calendar-form-tag-add')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-form-tags-hint')).toHaveTextContent('Outlook 범주에도 함께 반영돼요')
  })

  it('붙일 수 없는 M365 일정(공유받은 읽기 전용 달력)은 칩과 안내만 보이고 붙이기 버튼이 없다', () => {
    renderWithProviders(
      <EventTagsField value={[shared]} onChange={vi.fn()} editable={false} hint={TAG_HINT_OUTLOOK_READ_ONLY} />,
    )
    expect(screen.getByTestId('event-detail-tag')).toHaveTextContent('사내 공유')
    expect(screen.queryByTestId('calendar-form-tag-add')).not.toBeInTheDocument()
    expect(screen.getByText(TAG_HINT_OUTLOOK_READ_ONLY)).toBeInTheDocument()
  })

  it('붙일 수 없고 태그도 없으면 줄째 숨긴다', () => {
    renderWithProviders(<EventTagsField value={[]} onChange={vi.fn()} editable={false} hint={null} />)
    expect(screen.queryByTestId('calendar-form-tags')).not.toBeInTheDocument()
  })

  it('폼 상태라 체크하면 저장하지 않고 이름·색이 담긴 새 선택을 onChange 로만 넘긴다', () => {
    const onChange = vi.fn()
    renderWithProviders(<EventTagsField value={[ops]} onChange={onChange} editable hint={null} />)
    fireEvent.click(screen.getByTestId('calendar-form-tag-add'))
    fireEvent.click(screen.getByRole('checkbox', { name: '사내 공유' }))
    expect(onChange).toHaveBeenLastCalledWith([ops, shared])
    fireEvent.click(screen.getByRole('checkbox', { name: '운영' }))
    expect(onChange).toHaveBeenLastCalledWith([shared])
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
