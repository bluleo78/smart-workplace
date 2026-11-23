// 메일 별표(WP-1741) — 휴대폰 화면 테스트. 목록 행 별(터치에서도 보이고 눌림·행이 열리지 않음)과 상세 ⋯ 메뉴 「별표」/「별표 해제」를 본다.
// 한 파일 한 뷰포트라 데스크톱 판정(mailFlag.test.tsx)과 나눴다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import { mockViewport } from '@/test/viewport'

import { detail, summary } from '../../../e2e/factories/mail.factory'

mockViewport()

const LIST = '/api/v1/mail/accounts/1/messages'
const PUT_FLAG = '/api/v1/mail/messages/10/flag'
// 휴대폰 메일 머리줄의 🔔 가 부르는 안 읽은 알림 수 — 이 파일의 관심사가 아니라 0 으로 둔다.
const BELL = http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 }))

test('mobile row star flags without opening the mail', async () => {
  const put = record<{ flagged: boolean }>('put', PUT_FLAG, () => new HttpResponse(null, { status: 200 }))
  const { user, location } = renderMail('/mail/1', {
    handlers: [BELL, put.handler, http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true })]))],
  })
  await user.click(await screen.findByTestId('mail-row-star-10'))
  expect(screen.getByTestId('mail-row-star-10')).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(put.calls).toHaveLength(1))
  expect(put.last().body).toEqual({ flagged: true })
  expect(location().search).not.toContain('messageId')
})

test('mobile ⋯ menu 별표 then 별표 해제', async () => {
  const put = record<{ flagged: boolean }>('put', PUT_FLAG, () => new HttpResponse(null, { status: 200 }))
  const { user } = renderMail('/mail/1?messageId=10', {
    handlers: [
      BELL,
      put.handler,
      http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true })])),
      http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: true }))),
    ],
  })
  await user.click(await screen.findByRole('button', { name: '메일 메뉴' }))
  const item = screen.getByTestId('mail-flag')
  expect(item).toHaveTextContent('별표')
  await user.click(item)
  await waitFor(() => expect(put.calls).toHaveLength(1))
  expect(put.last().body).toEqual({ flagged: true })
  // 다시 열면 「별표 해제」 — 누르면 끈다.
  await user.click(screen.getByRole('button', { name: '메일 메뉴' }))
  const again = screen.getByTestId('mail-flag')
  expect(again).toHaveTextContent('별표 해제')
  await user.click(again)
  await waitFor(() => expect(put.calls).toHaveLength(2))
  expect(put.last().body).toEqual({ flagged: false })
})

test('mobile 기밀 메일 상세는 제목 앞 배지와 「[기밀]」 뺀 제목을 보인다(WP-2030)', async () => {
  renderMail('/mail/1?messageId=10', {
    handlers: [
      BELL,
      http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true, subject: '[기밀] 단가 협상안', confidential: true })])),
      http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: true, subject: '[기밀] 단가 협상안', confidential: true }))),
    ],
  })
  const heading = await screen.findByRole('heading', { level: 2, name: /단가 협상안/ })
  expect(heading).not.toHaveTextContent('[기밀]')
  expect(within(heading).getByTestId('mail-confidential-badge')).toBeInTheDocument()
})
