// 메일 「예약됨」(WP-1787) — 사이드바 항목·배지, 예약 목록 화면(행 모양·빈 상태), ⋯ 바로 보내기·예약 취소, 행 열기(예약 풀고 쓰기 창).
// 브라우저 레이아웃(390px 넘침)은 e2e/pages/mobile/mail-scheduled.spec.ts @layout 이 본다. 메일 모듈만 renderScreen 으로 띄운다(testkit-b4).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import type { MailScheduledSummary } from '@/types/mailDraft'

import { draftDetail } from '../../../e2e/factories/mail.factory'

const API = '/api/v1'

/** 예약 한 행 — 보낼 시각은 먼 미래(라벨이 날짜 형식이라 시계와 무관하게 안정). */
function sched(overrides: Partial<MailScheduledSummary> = {}): MailScheduledSummary {
  return {
    id: 21,
    accountId: 1,
    mode: 'new',
    to: ['김지은 <jieun@test.local>'],
    subject: '분기 보고',
    preview: '안녕하세요 보고드립니다',
    attachmentCount: 0,
    updatedAt: '2030-01-01T00:00:00Z',
    sendAt: '2031-03-02T00:00:00Z',
    ...overrides,
  }
}

const ROWS = [
  sched({ id: 21, to: ['김지은 <a@test.local>', '이철수 <b@test.local>', '박민수 <c@test.local>'], subject: '첫째', attachmentCount: 2 }),
  sched({ id: 22, subject: '둘째', sendAt: '2031-03-03T00:00:00Z', preview: '' }),
  sched({ id: 23, subject: '셋째', sendAt: '2031-03-04T00:00:00Z' }),
]

const listHandler = (rows: MailScheduledSummary[]) => http.get(`${API}/mail/drafts/scheduled`, () => HttpResponse.json(rows))
const countHandler = (scheduled: number) => http.get(`${API}/mail/drafts/count`, () => HttpResponse.json({ count: 0, queued: 0, scheduled }))

test('사이드바 「예약됨」 — ?folder=scheduled 링크와 예약 개수 배지, 현재 보기면 aria-current=page', async () => {
  renderMail('/mail/1?folder=scheduled', { handlers: [countHandler(3), listHandler(ROWS)] })
  const link = await screen.findByTestId('mail-folder-scheduled')
  expect(link).toHaveAttribute('href', '/mail/1?folder=scheduled')
  await waitFor(() => expect(link).toHaveAttribute('aria-current', 'page'))
  const badge = await screen.findByTestId('mail-count-scheduled')
  expect(badge).toHaveTextContent('3')
  expect(badge).toHaveAttribute('aria-label', '예약 3개')
})

test('예약이 없으면 배지를 숨기고, 다른 보기에서는 aria-current 가 없다', async () => {
  renderMail('/mail/1?folder=sent', { handlers: [countHandler(0)] })
  const link = await screen.findByTestId('mail-folder-scheduled')
  expect(link).not.toHaveAttribute('aria-current', 'page')
  expect(screen.queryByTestId('mail-count-scheduled')).not.toBeInTheDocument()
})

test('예약 목록 — 행마다 시각(주색 Clock)·받는 사람(외 N명)·첨부·제목·미리보기를 보이고 오른쪽 칸에 안내', async () => {
  renderMail('/mail/1?folder=scheduled', { handlers: [countHandler(3), listHandler(ROWS)] })
  const rows = await screen.findAllByTestId('mail-scheduled-row')
  expect(rows).toHaveLength(3)
  const first = within(rows[0])
  expect(first.getByTestId('mail-scheduled-at')).toHaveTextContent(/3월 2일 \(.\) /)
  expect(first.getByTestId('mail-scheduled-at').className).toMatch(/text-primary/)
  expect(first.getByText('김지은 외 2명')).toBeInTheDocument()
  expect(first.getByLabelText('첨부 2개')).toBeInTheDocument()
  expect(first.getByText('첫째')).toBeInTheDocument()
  expect(first.getByText('안녕하세요 보고드립니다')).toBeInTheDocument()
  // 둘째 — 받는 사람 1명은 이름만, 첨부 없음
  const second = within(rows[1])
  expect(second.getByText('김지은')).toBeInTheDocument()
  expect(second.queryByLabelText(/첨부/)).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-detail-pane')).toHaveTextContent('예약한 메일 선택')
  expect(screen.getByRole('heading', { name: '예약됨' })).toBeInTheDocument()
})

test('예약이 없으면 「예약한 메일 없음」', async () => {
  renderMail('/mail/1?folder=scheduled', { handlers: [countHandler(0), listHandler([])] })
  expect(await screen.findByTestId('mail-scheduled-empty')).toHaveTextContent('예약한 메일 없음')
})

test('⋯ 「예약 취소」 — cancel-send 를 부르고 「임시보관함으로 옮겼습니다」', async () => {
  const cancel = record('post', `${API}/mail/drafts/21/cancel-send`, () => HttpResponse.json(draftDetail({ id: 21 })))
  const { user } = renderMail('/mail/1?folder=scheduled', { handlers: [cancel.handler, countHandler(1), listHandler([ROWS[0]])] })
  await user.click(await screen.findByTestId('mail-scheduled-more'))
  await user.click(await screen.findByTestId('mail-scheduled-cancel'))
  await waitFor(() => expect(cancel.calls).toHaveLength(1))
  expect(await screen.findByText('임시보관함으로 옮겼습니다')).toBeInTheDocument()
  // 쓰기 창은 열지 않는다(⋯ 취소는 임시보관함으로 옮기기만)
  expect(screen.queryByTestId('mail-composer-body')).not.toBeInTheDocument()
})

test('⋯ 「바로 보내기」 — send-now 를 부르고 「곧 보냅니다」', async () => {
  const now = record('post', `${API}/mail/drafts/21/send-now`, () => HttpResponse.json({ draftId: 21, sendAt: '2030-01-01T00:00:00Z' }))
  const { user } = renderMail('/mail/1?folder=scheduled', { handlers: [now.handler, countHandler(1), listHandler([ROWS[0]])] })
  await user.click(await screen.findByTestId('mail-scheduled-more'))
  await user.click(await screen.findByTestId('mail-scheduled-send-now'))
  await waitFor(() => expect(now.calls).toHaveLength(1))
  expect(await screen.findByText('곧 보냅니다')).toBeInTheDocument()
})

test('⋯ 「바로 보내기」가 409 면 「이미 보냄」', async () => {
  const now = record('post', `${API}/mail/drafts/21/send-now`, () => HttpResponse.json({ code: 'ALREADY_SENDING', message: 'x' }, { status: 409 }))
  const { user } = renderMail('/mail/1?folder=scheduled', { handlers: [now.handler, countHandler(1), listHandler([ROWS[0]])] })
  await user.click(await screen.findByTestId('mail-scheduled-more'))
  await user.click(await screen.findByTestId('mail-scheduled-send-now'))
  expect(await screen.findByText('이미 보냄')).toBeInTheDocument()
  expect(screen.queryByText('곧 보냅니다')).not.toBeInTheDocument()
})

test('행을 누르면 예약을 풀고(cancel-send) 그 임시저장을 쓰기 창으로 연다 — 「임시보관함으로 옮겼습니다」는 없다', async () => {
  const cancel = record('post', `${API}/mail/drafts/21/cancel-send`, () => HttpResponse.json(draftDetail({ id: 21, subject: '예약했던 메일', to: ['rcpt@test.local'] })))
  const { user } = renderMail('/mail/1?folder=scheduled', { handlers: [cancel.handler, countHandler(1), listHandler([ROWS[0]])] })
  await user.click(await screen.findByTestId('mail-scheduled-row'))
  await waitFor(() => expect(cancel.calls).toHaveLength(1))
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('예약했던 메일'))
  expect(screen.queryByText('임시보관함으로 옮겼습니다')).not.toBeInTheDocument()
})

test('행을 두 번 연달아 눌러도 cancel-send 는 한 번, 쓰기 창이 열리고 「이미 보냄」은 없다', async () => {
  let n = 0
  const cancel = record('post', `${API}/mail/drafts/21/cancel-send`, async () => {
    n += 1
    if (n > 1) return HttpResponse.json({ code: 'DRAFT_NOT_FOUND', message: 'x' }, { status: 404 })
    await new Promise((r) => setTimeout(r, 30))
    return HttpResponse.json(draftDetail({ id: 21, subject: '두 번 눌러도 열림', to: ['rcpt@test.local'] }))
  })
  const { user } = renderMail('/mail/1?folder=scheduled', { handlers: [cancel.handler, countHandler(1), listHandler([ROWS[0]])] })
  const row = await screen.findByTestId('mail-scheduled-row')
  await user.dblClick(row)
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('두 번 눌러도 열림'))
  expect(cancel.calls).toHaveLength(1)
  expect(screen.queryByText('이미 보냄')).not.toBeInTheDocument()
})
