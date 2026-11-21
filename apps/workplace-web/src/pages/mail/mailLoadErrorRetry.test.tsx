// 메일 상세·목록 조회 실패 뒤 「다시 시도」 화면 테스트(WP-1908).
// 데이터 없이 실패한 쿼리를 다시 부르면 status 가 pending 으로 돌아 안내가 「불러오는 중…」으로 바뀌고 초점이 body 로 빠졌다 —
// 다시 부르는 동안에도 오류 안내·초점이 남고 단추가 잠기는지 본다. 두 번째 요청을 gate() 로 붙잡아 응답 전 상태를 단언한다.
// WP-1911: 이 파일의 WP-1911 테스트는 데이터 있는 중 재조회 실패(본문·목록 행 유지 · 배너로만 알림)와
// 다음 페이지(더 받기) 실패 — 배너 조건에서 빠져야 하는 경우 — 를 각각 고정한다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { MAIL_PAGE_SIZE } from '@/lib/mailListPages'
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
  // 테스트 클라이언트도 운영과 같은 staleTime 30초라, 눈앞에서 되돌아오는 사이 쿼리가 낡지 않는다 — 그사이 시간이 지난
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
  // 문구는 상세 배너와 맞춘다 — 「목록을 다시 불러오지 못했습니다」(요구 3, 리뷰 반려).
  expect(err).toHaveTextContent('목록을 다시 불러오지 못했습니다')
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

// WP-1911 리뷰 반려 — 다음 페이지(더 받기)만 실패해도 목록 배너가 떠 이중 안내(배너 + 목록 끝 오류)가 되고,
// 배너의 다시 시도(refetch) 가 이미 받은 페이지까지 다시 받았다. 배너 조건이 다음 페이지 실패를 빠지는지 고정한다.
test('다음 페이지를 받다 실패하면 목록 배너는 뜨지 않고 목록 끝 오류로만 알린다(WP-1911)', async () => {
  // 첫 페이지가 꽉 차야 다음 페이지 커서가 생긴다 — 서버 페이지 크기(MAIL_PAGE_SIZE)만큼만 받는다.
  const firstPage = Array.from({ length: MAIL_PAGE_SIZE }, (_, i) => summary({ id: 1000 - i, subject: `메일 ${i}` }))
  let listCalls = 0
  const handler = http.get('/api/v1/mail/accounts/1/messages', () => {
    listCalls += 1
    if (listCalls === 1) return HttpResponse.json(firstPage)
    return new HttpResponse(null, { status: 500 })
  })
  const { queryClient } = renderMail('/mail/1', { handlers: [handler] })
  await screen.findByTestId('mail-row-1000')

  // jsdom 의 IntersectionObserver 스텁은 교차를 알려 주지 않아 sentinel 이 저절로 다음 페이지를 부르지 않는다 —
  // 그 목록 쿼리의 observer 로 다음 페이지를 직접 받아 실패를 재현한다(요청 경로는 같다).
  const listQuery = queryClient.getQueryCache().getAll().find((q) => q.queryKey[0] === 'mail-messages')
  expect(listQuery).toBeTruthy()
  const fetchNextPage = (listQuery!.observers[0] as unknown as { fetchNextPage: () => Promise<unknown> } | undefined)
    ?.fetchNextPage
  expect(fetchNextPage).toBeTruthy()
  await act(async () => {
    await fetchNextPage!()
  })

  // 다음 페이지 실패는 목록 끝 푸터가 알린다 — 목록 위 배너는 뜨지 않아야 한다(이중 안내 · 전 페이지 재조회 방지).
  expect(listCalls).toBeGreaterThanOrEqual(2)
  expect(screen.queryByTestId('mail-list-error')).toBeNull()
  expect(screen.queryByText('목록을 다시 불러오지 못했습니다')).toBeNull()
  // 받은 행은 지워지지 않고, 실패는 다시 시도 버튼과 함께 목록 끝에 남는다.
  expect(screen.getByTestId('mail-row-1000')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('mail-list-end')).toHaveTextContent('불러오지 못했습니다 — 다시 시도'))
})

// 다음 페이지 실패로 배너가 꺼진 뒤, 목록 전체 재조회(주기·포커스)까지 실패하면 배너가 다시 뜬다 —
// TanStack 은 재조회를 시작하며 fetchMeta 를 비워 isFetchNextPageError 가 풀리기 때문이다. 전체 장애 신호가
// 남아야 하는 반쪽을 함께 고정한다(배너가 영영 안 뜨는 회귀를 막는다).
test('다음 페이지 실패 뒤 목록 전체 재조회도 실패하면 배너가 다시 뜬다(WP-1911)', async () => {
  const firstPage = Array.from({ length: MAIL_PAGE_SIZE }, (_, i) => summary({ id: 2000 - i, subject: `메일 ${i}` }))
  let listCalls = 0
  const handler = http.get('/api/v1/mail/accounts/1/messages', () => {
    listCalls += 1
    if (listCalls === 1) return HttpResponse.json(firstPage)
    return new HttpResponse(null, { status: 500 })
  })
  const { queryClient } = renderMail('/mail/1', { handlers: [handler] })
  await screen.findByTestId('mail-row-2000')
  const listQuery = queryClient.getQueryCache().getAll().find((q) => q.queryKey[0] === 'mail-messages')
  const fetchNextPage = (listQuery?.observers[0] as unknown as { fetchNextPage: () => Promise<unknown> } | undefined)
    ?.fetchNextPage
  expect(fetchNextPage).toBeTruthy()
  await act(async () => {
    await fetchNextPage!()
  })
  // 다음 페이지 실패만으로는 배너가 없다(꼬리 오류가 알린다).
  expect(screen.queryByTestId('mail-list-error')).toBeNull()

  // 그 뒤 목록 전체 재조회가 실패하면 — 배너가 다시 뜬다(전체 장애 신호 유지).
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['mail-messages'] })
  })
  expect(await screen.findByTestId('mail-list-error')).toBeInTheDocument()
  expect(screen.getByTestId('mail-row-2000')).toBeInTheDocument()
})

// WP-1911 리뷰 반려 2차 — 다음 페이지 실패 뒤 배경 재조회(60초 폴링·창 포커스)가 도는 동안에는 TanStack 이 재조회를
// 시작하며 fetchMeta 를 비워 isFetchNextPageError 가 풀리는데, 그 사이 목록 배너가 되살아나고 푸터 오류가 꺼졌다.
// 재조회가 확정된 실패로 끝나기 전에는 배너를 띄우지 않는 쪽을 고정한다(재조회 실패 시 배너가 서는 반쪽은 위 테스트).
test('다음 페이지 실패 뒤 배경 재조회 중에는 배너가 없다가 재조회가 실패로 끝나면 뜬다(WP-1911)', async () => {
  const firstPage = Array.from({ length: MAIL_PAGE_SIZE }, (_, i) => summary({ id: 3000 - i, subject: `메일 ${i}` }))
  const { promise, release } = gate()
  let listCalls = 0
  const handler = http.get('/api/v1/mail/accounts/1/messages', async () => {
    listCalls += 1
    if (listCalls === 1) return HttpResponse.json(firstPage)
    // 세 번째 호출(배경 재조회 첫 페이지)만 응답을 붙잡는다 — 재조회 중 화면을 응답 전에 단언하기 위해서다.
    if (listCalls === 3) await promise
    return new HttpResponse(null, { status: 500 })
  })
  const { queryClient } = renderMail('/mail/1', { handlers: [handler] })
  await screen.findByTestId('mail-row-3000')
  const listQuery = queryClient.getQueryCache().getAll().find((q) => q.queryKey[0] === 'mail-messages')
  const fetchNextPage = (listQuery?.observers[0] as unknown as { fetchNextPage: () => Promise<unknown> } | undefined)
    ?.fetchNextPage
  expect(fetchNextPage).toBeTruthy()
  await act(async () => {
    await fetchNextPage!()
  })
  // 다음 페이지 실패가 화면에 반영된다(목록 끝 푸터가 오류를 먼저 알린다) — 배경 재조회는 그 뒤에 시작된다(운영 순서:
  // 실패 → 주기·포커스 재조회). 오류가 그려지기 전에 재조회를 겹쳐 걸면 실패 사실이 화면에 한 번도 안 닿는다.
  await waitFor(() => expect(screen.getByTestId('mail-list-end')).toHaveTextContent('불러오지 못했습니다 — 다시 시도'))
  expect(screen.queryByTestId('mail-list-error')).toBeNull()

  // 배경 재조회(주기·포커스 흉내)를 띄우고 응답 전 — 배경 재조회는 확정된 실패가 아니므로 배너가 없어야 한다.
  let refetch: Promise<unknown> | undefined
  act(() => {
    refetch = queryClient.refetchQueries({ queryKey: ['mail-messages'] }) as Promise<unknown>
  })
  await waitFor(() => expect(listCalls).toBe(3))
  expect(screen.queryByTestId('mail-list-error')).toBeNull()
  expect(screen.getByTestId('mail-row-3000')).toBeInTheDocument()

  // 재조회가 실패로 끝나면 전체 장애 신호로서 배너가 다시 선다(받은 행은 남는다).
  release()
  await act(async () => {
    await refetch
  })
  expect(await screen.findByTestId('mail-list-error')).toBeInTheDocument()
  expect(screen.getByTestId('mail-row-3000')).toBeInTheDocument()
})
