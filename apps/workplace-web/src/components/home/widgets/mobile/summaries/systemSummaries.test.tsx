import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MailSummary, MailSummaryItem } from '@/types/dashboard'

import { UnreadMailSummary } from './systemSummaries'

// 모바일 홈 메일 요약 한 줄(WP-1180) — 보이지 않는 글자뿐인 제목이 「보낸사람 · 」 뒤 빈칸이 아니라 「(제목 없음)」으로 보이는지 본다.
// 데이터 훅은 끊고, 요약이 넘기는 본문(text)을 그대로 그려 글자를 확인한다.

const mailSummary = vi.hoisted(() => ({ current: undefined as MailSummary | undefined }))
vi.mock('@/hooks/queries/useMailSummary', () => ({
  useMailSummary: () => ({ data: mailSummary.current, isLoading: false, isError: false }),
}))

function mail(subject: string | null): MailSummaryItem {
  return {
    id: 1,
    accountId: 1,
    subject,
    fromAddress: 'kim@a.com',
    fromName: '김철수',
    snippet: '',
    receivedAt: '2026-10-29T00:00:00Z',
    seen: false,
    hasAttachment: false,
    aiCategory: null,
    aiNeedsReply: null,
  } as MailSummaryItem
}

function renderSummary(subject: string | null) {
  mailSummary.current = { unreadCount: 1, needsReplyCount: 0, classificationActive: false, recent: [mail(subject)] }
  render(<UnreadMailSummary render={(d) => <p data-testid="summary">{d.text}</p>} />)
  return screen.getByTestId('summary').textContent
}

describe('UnreadMailSummary — 메일 제목', () => {
  beforeEach(() => {
    mailSummary.current = undefined
  })

  it.each([
    ['제로폭 공백', '​'],
    ['공백과 단어 연결자', ' ⁠ '],
    ['빈 문자열', ''],
    ['없음', null],
  ])('%s 제목은 「(제목 없음)」', (_name, subject) => {
    expect(renderSummary(subject)).toBe('김철수 · (제목 없음)')
  })

  it('보이는 제목은 그대로', () => {
    expect(renderSummary('견적 요청')).toBe('김철수 · 견적 요청')
  })
})
