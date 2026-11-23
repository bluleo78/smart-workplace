// 홈 대시보드 위젯 행 Link 의 접근 설명(WP-1899).
// 행 Link 는 aria-label 로 이름을 짧게(제목·대화명만) 두고, 화면에 보이는 보조 정보(보낸 사람·배지·시각·미리보기)는
// aria-describedby 로 이어 설명으로 전달한다. jsdom 이 계산한 접근 설명(toHaveAccessibleDescription)으로 판정한다.
import { screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { CalendarEvent } from '@/types/calendar'
import type { ConversationSummaryItem, MailSummaryItem } from '@/types/dashboard'

import CalendarTodayBody from './CalendarTodayBody'
import ConversationsBody from './ConversationsBody'
import UnreadMailBody from './UnreadMailBody'

/** 3분 전 시각 — relTime 이 「3분 전」으로 표기한다. */
const threeMinAgo = () => new Date(Date.now() - 3 * 60_000).toISOString()

function mail(over: Partial<MailSummaryItem> = {}): MailSummaryItem {
  return {
    id: 1,
    accountId: 10,
    subject: '3분기 예산안',
    fromAddress: 'kim@example.com',
    fromName: '김개발',
    snippet: '초안을 보내드립니다',
    receivedAt: threeMinAgo(),
    seen: false,
    hasAttachment: false,
    aiCategory: null,
    aiNeedsReply: true,
    ...over,
  } as MailSummaryItem
}

function conv(over: Partial<ConversationSummaryItem> = {}): ConversationSummaryItem {
  return {
    kind: 'CHANNEL',
    conversationId: 5,
    label: '기획팀',
    lastAuthorName: '박기획',
    lastMessagePreview: '회의 자료 확인 부탁',
    lastMessageAt: threeMinAgo(),
    unreadCount: 1,
    mentioned: true,
    needsReply: false,
    newThreadReplyCount: 0,
    aiReason: null,
    ...over,
  }
}

test('메일 행은 이름은 제목만, 설명에 보낸 사람·회신필요·시간·미리보기를 담는다', () => {
  renderScreen(<UnreadMailBody previewData={[mail()]} />, { path: '/' })
  const link = screen.getByRole('link', { name: '메일 열기: 3분기 예산안' })
  expect(link).toHaveAccessibleDescription(/김개발.*회신필요.*3분 전.*초안을 보내/)
})

test('배지·미리보기·시각이 없는 메일 행은 보낸 사람만 설명한다', () => {
  renderScreen(
    <UnreadMailBody previewData={[mail({ aiNeedsReply: false, snippet: '', receivedAt: null })]} />,
    { path: '/' },
  )
  const link = screen.getByRole('link', { name: '메일 열기: 3분기 예산안' })
  expect(link).toHaveAccessibleDescription('김개발')
})

// WP-2030 리뷰 후속: 받은 기밀 메일 행은 머리말을 뺀 제목 + 「기밀」 배지, 이름에 (기밀)
test('기밀 메일 행은 머리말을 빼고 배지를 보인다', () => {
  renderScreen(
    <UnreadMailBody previewData={[mail({ subject: '[기밀] 단가 협상안', confidential: true })]} />,
    { path: '/' },
  )
  const link = screen.getByRole('link', { name: '메일 열기: 단가 협상안 (기밀)' })
  expect(link).toHaveTextContent('단가 협상안')
  expect(link).not.toHaveTextContent('[기밀]')
  expect(screen.getByTestId('mail-confidential-badge')).toBeInTheDocument()
})

test('대화 행은 설명에 배지·미리보기·시간을 담는다', () => {
  renderScreen(<ConversationsBody previewData={[conv()]} />, { path: '/' })
  const link = screen.getByRole('link', { name: '대화 열기: 기획팀' })
  expect(link).toHaveAccessibleDescription(/멘션.*3분 전.*박기획: 회의 자료 확인 부탁/)
})

test('배지·시각 없는 대화 행은 미리보기만 설명한다', () => {
  renderScreen(
    <ConversationsBody previewData={[conv({ mentioned: false, lastMessageAt: null })]} />,
    { path: '/' },
  )
  const link = screen.getByRole('link', { name: '대화 열기: 기획팀' })
  expect(link).toHaveAccessibleDescription('박기획: 회의 자료 확인 부탁')
})

test('AI 발굴 배지가 있는 대화 행은 설명에 「확인 필요」를 담는다', () => {
  renderScreen(
    <ConversationsBody previewData={[conv({ mentioned: false, aiReason: '지난주 논의와 이어져요' })]} />,
    { path: '/' },
  )
  const link = screen.getByRole('link', { name: '대화 열기: 기획팀' })
  expect(link).toHaveAccessibleDescription(/확인 필요.*3분 전.*박기획: 회의 자료 확인 부탁/)
})

test('작성자·미리보기가 없는 대화 행은 미리보기 id 를 잇지 않는다', () => {
  renderScreen(
    <ConversationsBody
      previewData={[conv({ mentioned: false, lastAuthorName: null, lastMessagePreview: '' })]}
    />,
    { path: '/' },
  )
  const link = screen.getByRole('link', { name: '대화 열기: 기획팀' })
  // 시간만 남는다 — 미리보기 span 에는 id 가 없고 describedby 도 그 id 를 담지 않는다.
  expect(link).toHaveAccessibleDescription('3분 전')
  expect(link.getAttribute('aria-describedby')).not.toMatch(/preview/)
})

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 1,
    title: '주간 회의',
    allDay: false,
    // 로컬 시각 10:00 — eventTime 이 「10:00」을 낸다(시간대와 무관).
    startsAt: new Date(2026, 10, 21, 10, 0).toISOString(),
    endsAt: new Date(2026, 10, 21, 11, 0).toISOString(),
    ...over,
  } as CalendarEvent
}

test('일정 행은 설명에 시각 라벨을 담는다', () => {
  renderScreen(
    <CalendarTodayBody
      previewData={[
        event(),
        event({ id: 2, title: '워크숍', allDay: true }),
        // 시작 시각을 해석할 수 없으면 「미정」(bodyRules.eventTime).
        event({ id: 3, title: '미정 일정', startsAt: 'invalid' }),
      ]}
    />,
    { path: '/' },
  )
  expect(screen.getByRole('link', { name: '일정 열기: 주간 회의' })).toHaveAccessibleDescription('10:00')
  expect(screen.getByRole('link', { name: '일정 열기: 워크숍' })).toHaveAccessibleDescription('종일')
  expect(screen.getByRole('link', { name: '일정 열기: 미정 일정' })).toHaveAccessibleDescription('미정')
})

test('같은 id 의 반복 일정 회차는 행마다 자기 시각을 설명한다', () => {
  renderScreen(
    <CalendarTodayBody
      previewData={[
        event({ id: 1, occurrenceDate: '2026-11-21T00:00:00Z' }),
        event({
          id: 1,
          occurrenceDate: '2026-11-22T00:00:00Z',
          startsAt: new Date(2026, 10, 21, 14, 0).toISOString(),
          endsAt: new Date(2026, 10, 21, 15, 0).toISOString(),
        }),
      ]}
    />,
    { path: '/' },
  )
  const links = screen.getAllByRole('link', { name: '일정 열기: 주간 회의' })
  expect(links).toHaveLength(2)
  expect(links[0]).toHaveAccessibleDescription('10:00')
  expect(links[1]).toHaveAccessibleDescription('14:00')
})

test('첨부가 있는 메일 행은 설명 끝에 「첨부 있음」을 담는다', () => {
  renderScreen(<UnreadMailBody previewData={[mail({ hasAttachment: true })]} />, { path: '/' })
  const link = screen.getByRole('link', { name: '메일 열기: 3분기 예산안' })
  expect(link).toHaveAccessibleDescription(/초안을 보내드립니다.*첨부 있음$/)
})
