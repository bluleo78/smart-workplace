// 메일 상세·목록 조회 실패 뒤 「다시 시도」 화면 테스트(WP-1908).
// 데이터 없이 실패한 쿼리를 다시 부르면 status 가 pending 으로 돌아 안내가 「불러오는 중…」으로 바뀌고 초점이 body 로 빠졌다 —
// 다시 부르는 동안에도 오류 안내·초점이 남고 단추가 잠기는지 본다. 두 번째 요청을 gate() 로 붙잡아 응답 전 상태를 단언한다.
// WP-1911: 이어지는 두 테스트는 데이터가 있는 중 재조회가 실패한 경우 — 본문·목록 행을 지우지 않고 배너로만 알린다.
import { act, screen, waitFor, within } from '@testing-library/react'
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

test('상세 재조회가 데이터 있는 중 실패하면 본문을 지우지 않고 배너로만 알린다(WP-1911)', async () => {
  const detailCalls = { n: 0 }
  const ok100 = http.get('/api/v1/mail/messages/100', () => {
    detailCalls.n += 1
    if (detailCalls.n === 1) return HttpResponse.json(detail({ id: 100, subject: '월간 보고서' }))
    return new HttpResponse(null, { status: 500 })
  })
  const ok101 = http.get('/api/v1/mail/messages/101', () => HttpResponse.json(detail({ id: 101, subject: '회의록' })))
  const { user, queryClient } = renderMail('/mail/1?messageId=100', {
    messages: [summary({ id: 100, subject: '월간 보고서' }), summary({ id: 101, subject: '회의록' })],
    handlers: [ok100, ok101],
  })
  await screen.findByTestId('mail-detail')
  // 다른 메일을 거쳐 되돌아오면 상세가 다시 받아진다 — 첫 데이터가 있는데 재조회가 실패한 경우다.
  await user.click(screen.getByTestId('mail-row-101'))
  // 테스트 클라우드도 운영과 같은 staleTime 30초라, 눈앞에서 되돌아오는 사이 쿼리가 낡지 않는다 — 그사이 시간이 지난
  // 경우(재조회 대상)를 흉내 내려 낡음만 표시해 둔다(refetchType 'none' — 표시만 하고 여기서는 부르지 않는다).
  await act(async () => {
    queryClient.invalidateQueries({ queryKey: ['mail-message', 100], refetchType: 'none' })
  })
  await user.click(screen.getByTestId('mail-row-100'))
  const err = await screen.findByTestId('mail-detail-error')
  expect(screen.getByTestId('mail-detail')).toHaveTextContent('월간 보고서')
  expect(within(err).getByRole('button', { name: /다시 시도/ })).toBeInTheDocument()
  // 데스크톱은 배너가 #mail-detail 의 첫 자식이다 — 본문을 덮지 않고 맨 위 한 줄로만 실패를 알린다(WP-1911).
  expect(screen.getByTestId('mail-detail').firstElementChild).toHaveAttribute('data-testid', 'mail-detail-error')
})

test('목록 재조회가 데이터 있는 중 실패하면 행을 지우지 않고 배너로만 알린다(WP-1911)', async () => {
  const { promise, release } = gate()
  let calls = 0
  const handler = http.get('/api/v1/mail/accounts/1/messages', async () => {
    calls += 1
    if (calls === 1) return HttpResponse.json([summary({ id: 11, subject: '점심 메뉴' })])
    // 세 번째 호출(다시 시도)만 응답을 붙잡는다 — 재조회 중(aria-busy) 화면을 응답 전에 단언하기 위해서다(WP-1908 과 같은 방식).
    if (calls === 3) await promise
    return new HttpResponse(null, { status: 500 })
  })
  const { user, queryClient } = renderMail('/mail/1', { handlers: [handler] })
  await screen.findByTestId('mail-row-11')
  // 창 포커스 재조회를 흉낸다 — useMailMessages 가 켠 refetchOnWindowFocus 경로로 목록을 다시 받는 상황.
  await act(async () => {
    // 포커스 재조회도 낡은 데이터만 다시 부른다 — 방금 받아 캐시가 싱싱하므로 낡음만 표시해 둔다(표시만 하고 여기서는 부르지 않는다).
    queryClient.invalidateQueries({ queryKey: ['mail-messages'], refetchType: 'none' })
    // 실제 visibilitychange 는 document 에서 나와 window 로 번져 TanStack focusManager 에 닿는다 —
    // 번지지 않는 이벤트는 window 리스너에 닿지 않으므로(bubbles: false) bubbles 로 똑같이 흉낸다.
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  })
  const err = await screen.findByTestId('mail-list-error')
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
  // 「다시 시도」를 눌러도 안내·행이 남고 초점이 단추에 있는지 — clickRetryAndExpectErrorKept 와 같은 단언을,
  // 이 테스트는 초기 조회·포커스 재조회에 이어 세 번째 호출이라 호출 수를 직접 센다.
  const retry = within(err).getByRole('button', { name: /다시 시도/ })
  await user.click(retry)
  await waitFor(() => expect(calls).toBe(3))
  await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'))
  expect(screen.getByTestId('mail-list-error')).toBeInTheDocument()
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
  expect(screen.queryByText('불러오는 중…')).toBeNull()
  expect(document.activeElement).toBe(retry)
  release()
  // 게이트를 푼 뒤 세 번째 호출도 500 이라 성공 단언은 불가능 — 단추가 잠금(aria-busy)에서 풀리는지만 보며 라운드를 닫는다.
  await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'))
})
