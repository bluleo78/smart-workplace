// 메일 상세·목록 조회 실패 뒤 「다시 시도」 화면 테스트(WP-1908).
// 데이터 없이 실패한 쿼리를 다시 부르면 status 가 pending 으로 돌아 안내가 「불러오는 중…」으로 바뀌고 초점이 body 로 빠졌다 —
// 다시 부르는 동안에도 오류 안내·초점이 남고 단추가 잠기는지 본다. 두 번째 요청을 gate() 로 붙잡아 응답 전 상태를 단언한다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderMail } from '@/test/kits/mail/testkit-b4'
import { clickRetryAndExpectErrorKept, gate } from '@/test/loadErrorRetry'

import { detail, summary } from '../../../e2e/factories/mail.factory'

test('메일 상세가 실패한 뒤 다시 시도하는 동안 오류 안내와 초점이 남고 단추가 잠긴다(WP-1908)', async () => {
  const { promise, release } = gate()
  let calls = 0
  const handler = http.get('/api/v1/mail/messages/100', async () => {
    calls += 1
    if (calls === 1) return new HttpResponse(null, { status: 500 })
    await promise
    return HttpResponse.json(detail({ id: 100, subject: '월간 보고서' }))
  })
  const { user } = renderMail('/mail/1?messageId=100', {
    messages: [summary({ id: 100, subject: '월간 보고서' })],
    handlers: [handler],
  })
  await clickRetryAndExpectErrorKept(user, 'mail-detail-error', () => calls)
  release()
  expect(await screen.findByTestId('mail-detail')).toHaveTextContent('월간 보고서')
  expect(screen.queryByTestId('mail-detail-error')).toBeNull()
})

test('메일 목록이 실패한 뒤 다시 시도하는 동안 오류 안내와 초점이 남는다(WP-1908)', async () => {
  const { promise, release } = gate()
  let calls = 0
  const handler = http.get('/api/v1/mail/accounts/1/messages', async () => {
    calls += 1
    if (calls === 1) return new HttpResponse(null, { status: 500 })
    await promise
    return HttpResponse.json([summary({ id: 11, subject: '점심 메뉴' })])
  })
  const { user } = renderMail('/mail/1', { handlers: [handler] })
  await clickRetryAndExpectErrorKept(user, 'mail-list-error', () => calls)
  release()
  await waitFor(() => expect(screen.getByTestId('mail-row-11')).toBeInTheDocument())
  expect(screen.queryByTestId('mail-list-error')).toBeNull()
})
