// 메일 별표(WP-1741) — 데스크톱 화면 테스트.
// 목록 행 별(바로 반영·행이 열리지 않음·PUT 본문), 읽기 창 「별표」/「별표 해제」가 행 별과 같게 바뀌는지, 실패 시 되돌림 + 토스트를 본다.
// 브라우저 없이 판정되므로 vitest 로 둔다(apps/workplace-web/CLAUDE.md 「테스트 종류 판정」). 휴대폰 ⋯ 메뉴는 mailFlagMobile.test.tsx(한 파일 한 뷰포트).
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import type { EmailMessageDetail, EmailMessageSummary } from '@/types/mailMessage'

import { detail, summary } from '../../../e2e/factories/mail.factory'

const LIST = '/api/v1/mail/accounts/1/messages'
const DETAIL = '/api/v1/mail/messages/10'
const PUT_FLAG = '/api/v1/mail/messages/10/flag'

/** 메일 10 한 통을 목록으로 준다(읽은 메일 — 열어도 읽음 요청이 나가지 않게). */
function listHandler(row: Partial<EmailMessageSummary> = {}) {
  return http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true, ...row })]))
}

/** 메일 10 상세 — 요청을 기록해 「행 별은 메일을 열지 않는다」를 본다. */
function detailRecorder(det: Partial<EmailMessageDetail> = {}) {
  return record('get', DETAIL, () => HttpResponse.json(detail({ id: 10, seen: true, ...det })))
}

test('row star flags immediately without opening the mail', async () => {
  const put = record<{ flagged: boolean }>('put', PUT_FLAG, () => new HttpResponse(null, { status: 200 }))
  const det = detailRecorder()
  const { user, location } = renderMail('/mail/1', { handlers: [put.handler, det.handler, listHandler()] })
  const star = await screen.findByTestId('mail-row-star-10')
  expect(star).toHaveAccessibleName('별표')
  expect(star).toHaveAttribute('aria-pressed', 'false')
  await user.click(star)
  // 바로 채운 별 — 응답을 기다리지 않는다(낙관 갱신).
  expect(screen.getByTestId('mail-row-star-10')).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(put.calls).toHaveLength(1))
  expect(put.last().body).toEqual({ flagged: true })
  // 행 열기와 분리 — 주소에 messageId 가 없고 상세 조회도 없다.
  expect(location().search).not.toContain('messageId')
  expect(det.calls).toHaveLength(0)
  expect(screen.getByTestId('mail-detail-empty')).toBeInTheDocument()
})

test('flagged row star unflags with flagged:false', async () => {
  const put = record<{ flagged: boolean }>('put', PUT_FLAG, () => new HttpResponse(null, { status: 200 }))
  const { user } = renderMail('/mail/1', { handlers: [put.handler, listHandler({ flagged: true })] })
  const star = await screen.findByTestId('mail-row-star-10')
  expect(star).toHaveAttribute('aria-pressed', 'true')
  await user.click(star)
  expect(screen.getByTestId('mail-row-star-10')).toHaveAttribute('aria-pressed', 'false')
  await waitFor(() => expect(put.calls).toHaveLength(1))
  expect(put.last().body).toEqual({ flagged: false })
})

test('reading pane 별표 / 별표 해제 toggles and stays in sync with the row star', async () => {
  const put = record<{ flagged: boolean }>('put', PUT_FLAG, () => new HttpResponse(null, { status: 200 }))
  const det = detailRecorder()
  const { user } = renderMail('/mail/1?messageId=10', { handlers: [put.handler, det.handler, listHandler()] })
  const button = await screen.findByTestId('mail-flag')
  expect(button).toHaveTextContent('별표')
  expect(button).not.toHaveTextContent('별표 해제')
  await user.click(button)
  expect(screen.getByTestId('mail-flag')).toHaveTextContent('별표 해제')
  expect(screen.getByTestId('mail-row-star-10')).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(put.calls).toHaveLength(1))
  expect(put.last().body).toEqual({ flagged: true })
  // 행 별로 끄면 읽기 창 단추도 「별표」로 돌아온다(같은 값을 본다).
  await user.click(screen.getByTestId('mail-row-star-10'))
  expect(screen.getByTestId('mail-flag')).not.toHaveTextContent('별표 해제')
  await waitFor(() => expect(put.calls).toHaveLength(2))
  expect(put.last().body).toEqual({ flagged: false })
  // 별표는 상세를 닫지 않는다.
  expect(screen.getByTestId('mail-flag')).toBeInTheDocument()
})

test('reading pane shows 별표 해제 for a flagged mail', async () => {
  const det = detailRecorder({ flagged: true })
  renderMail('/mail/1?messageId=10', { handlers: [det.handler, listHandler({ flagged: true })] })
  expect(await screen.findByTestId('mail-flag')).toHaveTextContent('별표 해제')
})

test('failed flag request rolls the star back and shows an error toast', async () => {
  const put = record('put', PUT_FLAG, () => new HttpResponse(null, { status: 500 }))
  const det = detailRecorder()
  const { user } = renderMail('/mail/1?messageId=10', { handlers: [put.handler, det.handler, listHandler()] })
  await user.click(await screen.findByTestId('mail-row-star-10'))
  expect(await screen.findByText('별표를 바꾸지 못했어요')).toBeInTheDocument()
  expect(put.calls).toHaveLength(1)
  // 목록 행과 읽기 창 모두 이전 값으로.
  expect(screen.getByTestId('mail-row-star-10')).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByTestId('mail-flag')).not.toHaveTextContent('별표 해제')
})
