// 별표한 메일 모아 보기(WP-1742) — 휴대폰 화면 테스트. ☰ 시트(메일함 목록)의 「별표」 항목으로 별표 목록에 들어가 행마다 메일함 배지가 보이고,
// 상세 ⋯ 「별표 해제」로 끄면 목록에서 빠지며 실행 취소 토스트가 뜨는지 본다. 한 파일 한 뷰포트라 데스크톱 판정(mailFlagged.test.tsx)과 나눴다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { record, renderMail, unreadCounts } from '@/test/kits/mail/testkit-b4'
import { mockViewport } from '@/test/viewport'

import { detail, summary } from '../../../e2e/factories/mail.factory'

mockViewport()

const LIST = '/api/v1/mail/accounts/1/messages'
// 휴대폰 메일 머리줄의 🔔 가 부르는 안 읽은 알림 수 — 이 파일의 관심사가 아니라 0 으로 둔다.
const BELL = http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 }))
const COUNTS = http.get('/api/v1/mail/accounts/1/unread-counts', () => HttpResponse.json(unreadCounts({ flagged: 1 })))
const ROW = summary({ id: 10, seen: true, flagged: true, subject: '견적 요청', folderName: '보관' })

test('☰ sheet 별표 item opens the flagged list with folder badges', async () => {
  const list = record('get', LIST, ({ url }) => HttpResponse.json(url.searchParams.get('flagged') === 'true' ? [ROW] : []))
  const { user, location } = renderMail('/mail/1', { handlers: [BELL, COUNTS, list.handler] })
  await user.click(await screen.findByTestId('mobile-sidebar-trigger'))
  const sheet = await screen.findByTestId('mobile-sidebar-sheet')
  const item = within(sheet).getByTestId('mail-folder-flagged')
  expect(within(sheet).getByTestId('mail-count-flagged')).toHaveTextContent('1')
  await user.click(item)
  await waitFor(() => expect(location()).toBe('/mail/1?flagged=true'))
  expect(await screen.findByTestId('mail-row-folder-10')).toHaveTextContent('보관')
  await waitFor(() => expect(list.last().url.searchParams.get('flagged')).toBe('true'))
})

test('mobile ⋯ 별표 해제 in the flagged view removes the row and offers 실행 취소', async () => {
  // 서버처럼 별표 상태를 기억한다 — 끈 뒤 다시 받은 별표 목록에도 없어야 한다.
  let flagged = true
  const put = record<{ flagged: boolean }>('put', '/api/v1/mail/messages/10/flag', ({ body }) => {
    flagged = body.flagged
    return new HttpResponse(null, { status: 200 })
  })
  const { user } = renderMail('/mail/1?flagged=true&messageId=10', {
    handlers: [
      BELL,
      COUNTS,
      put.handler,
      http.get(LIST, () => HttpResponse.json(flagged ? [ROW] : [])),
      http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: true, flagged: true }))),
    ],
  })
  await screen.findByTestId('mail-row-10')
  await user.click(await screen.findByRole('button', { name: '메일 메뉴' }))
  const item = screen.getByTestId('mail-flag')
  expect(item).toHaveTextContent('별표 해제')
  await user.click(item)
  await waitFor(() => expect(put.last()?.body).toEqual({ flagged: false }))
  expect(await screen.findByText('별표를 해제했습니다')).toBeInTheDocument()
  // 상세 아래 목록(휴대폰은 상세가 열리면 목록이 숨는다)에서도 행이 빠진다.
  expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '실행 취소' }))
  await waitFor(() => expect(put.calls).toHaveLength(2))
  expect(put.last().body).toEqual({ flagged: true })
})
