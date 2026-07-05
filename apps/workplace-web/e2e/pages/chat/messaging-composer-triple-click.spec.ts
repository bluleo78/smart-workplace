// RichInput 인플라이트 가드 회귀 테스트 (#586).
// 전송 버튼을 동일 이벤트 루프 틱 내에 3회 연속(프로그래밍적) 클릭해도
// 메시지 전송 POST 는 정확히 1번만 발생해야 한다.
// 백엔드 없이 page.route() 로 API 모킹 (messaging-composer-upload.spec.ts 패턴 동일).
import { expect, test } from '../../fixtures/auth.fixture'
import { createChannel, createChannelMember, createMessage } from '../../factories/messaging.factory'

const CHANNEL_ID = 810

async function stubCommon(page: import('@playwright/test').Page) {
  const channel = createChannel({ id: CHANNEL_ID, name: '연속클릭테스트' })

  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([channel]) })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === '/api/v1/events',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: `:\n\n`,
      }),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([createChannelMember({ userId: 1, name: '테스트 사용자', kind: 'HUMAN' })]),
          })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
          })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/read`,
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 204, contentType: 'application/json', body: '' })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }),
          })
        : route.fallback(),
  )

  return channel
}

test(
  '채널 메시지 — 전송 버튼 3회 연속 클릭해도 전송 API 는 1번만 호출된다 (#586)',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await stubCommon(page)

    // POST 호출 횟수 카운트 — race condition 재현을 위해 약간의 지연을 준다
    // (실제 네트워크 latency가 있는 환경에서 중복 전송이 재현되기 쉬운 조건을 모사).
    let postCount = 0
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      async (route) => {
        if (route.request().method() === 'POST') {
          postCount += 1
          await new Promise((r) => setTimeout(r, 200))
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(
              createMessage({
                id: postCount,
                channelId: CHANNEL_ID,
                authorId: 1,
                authorName: '테스트 사용자',
                authorKind: 'HUMAN',
                body: '중복전송테스트',
              }),
            ),
          })
        }
        return route.fallback()
      },
    )

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId('message-composer')).toBeVisible()

    await page.getByTestId('message-composer-input').click()
    await page.keyboard.type('중복전송테스트')

    const submitButton = page.getByTestId('message-composer-submit')
    await expect(submitButton).toBeEnabled()

    // 같은 이벤트 루프 틱 내에 3번 dispatch — React state(submitting) 리렌더 전에
    // disabled 속성이 반영되기 전 상태를 재현(실제 버그의 근본 원인 조건, 이슈 재현 스크립트와 동일).
    await submitButton.evaluate((el: HTMLButtonElement) => {
      el.click()
      el.click()
      el.click()
    })

    // 전송 완료(입력창이 비워짐) 대기 후 POST 는 정확히 1번만 발생해야 한다.
    await expect(page.getByTestId('message-composer-input')).toHaveText('')
    expect(postCount).toBe(1)
  },
)
