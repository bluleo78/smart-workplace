// messaging Phase 4 E2E — 멘션 전송 · 인라인 수정/삭제 · 사이드바 unread 배지.
// 백엔드 없이 page.route() 로 모든 API 모킹. 컴포저는 contenteditable(RichInput/TipTap).
import type { Page } from '@playwright/test'

import {
  createChannel,
  createChannelMember,
  createMessage,
} from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

// auth.fixture 의 createUser() 기본 id = 1 → "본인" 메시지 판정 기준.
const ME_ID = 1

// 채널/DM 사이드바 목록 + SSE 스트림 stub. ChatModuleLayout 이 항상 구독한다.
// channels 는 호출자가 더 구체적으로 다시 등록할 수 있게 인자로 받는다.
async function stubChannelsList(page: Page, channels: ReturnType<typeof createChannel>[]) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(channels),
          })
        : route.fallback(),
  )
}

async function stubDmsList(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )
}

// SSE 스트림 stub — body 로 임의 이벤트(또는 keep-alive)를 흘릴 수 있다.
async function stubStream(page: Page, body = `:\n\n`) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body,
      }),
  )
}

// 채널 상세(헤더) GET stub.
async function stubChannelDetail(page: Page, channel: ReturnType<typeof createChannel>) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
        : route.fallback(),
  )
}

// 채널 멤버 GET stub — @멘션 후보.
async function stubMembers(
  page: Page,
  channelId: number,
  members: ReturnType<typeof createChannelMember>[],
) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) })
        : route.fallback(),
  )
}

// 메시지 히스토리 GET stub.
async function stubMessages(
  page: Page,
  channelId: number,
  items: ReturnType<typeof createMessage>[],
) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items, nextCursor: null, hasMore: false }),
          })
        : route.fallback(),
  )
}

test.describe('messaging Phase 4 — 멘션·수정/삭제·unread', () => {
  // 1) 멘션: @ 입력 → 후보 선택 → 전송 → 멘션 칩 렌더 + payload <@id> 검증.
  test('멘션을 골라 전송하면 멘션 칩이 렌더된다', async ({ authenticatedPage: page }) => {
    const CHANNEL_ID = 200
    const channel = createChannel({ id: CHANNEL_ID, name: '멘션채널', member: true })
    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [
      createChannelMember({ userId: ME_ID, name: '나' }),
      createChannelMember({ userId: 2, name: '밥' }),
    ])
    await stubMessages(page, CHANNEL_ID, [])

    // POST messages — body 에 <@2> 가 직렬화돼 들어와야 하고, 응답은 mentions 를 채워 반환.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        const payload = route.request().postDataJSON() as { body: string }
        // 직렬화 본문에 멘션 토큰이 포함돼야 한다(앞뒤 텍스트/공백은 허용).
        expect(payload.body).toContain('<@2>')
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(
            createMessage({
              id: 700,
              channelId: CHANNEL_ID,
              authorId: ME_ID,
              authorName: '나',
              body: payload.body,
              mentions: [{ id: 2, username: 'bob', name: '밥', kind: 'HUMAN' }],
            }),
          ),
        })
      },
    )

    await page.goto(`/chat/channels/${CHANNEL_ID}`)

    // @ → '밥' 타이핑 → suggestion 옵션 노출 → Enter 로 선택(팝업 열림 동안 Enter 는 선택에 위임).
    await page.getByTestId('message-composer-input').click()
    await page.keyboard.type('@밥')
    await expect(page.getByTestId('chat-mention-option-2')).toBeVisible()
    await page.keyboard.press('Enter')
    // 팝업이 닫힌(선택 완료) 뒤 send 버튼으로 전송 — Enter/팝업 레이스 회피.
    await expect(page.getByTestId('chat-mention-option-2')).toHaveCount(0)
    await page.getByTestId('message-composer-submit').click()

    // 서버 확정 메시지(700) 에 멘션 칩(2) 이 렌더돼야 한다.
    await expect(page.getByTestId('message-body-700')).toBeVisible()
    await expect(page.getByTestId('mention-chip-2')).toBeVisible()
    await expect(page.getByTestId('mention-chip-2')).toHaveText('@밥')
  })

  // 2) 수정/삭제: 본인 메시지 hover → 수정 인라인 에디터 저장(수정됨) → 삭제((삭제됨)).
  test('본인 메시지를 수정하면 수정됨, 삭제하면 (삭제됨) 으로 바뀐다', async ({
    authenticatedPage: page,
  }) => {
    const CHANNEL_ID = 201
    const MSG_ID = 800
    const channel = createChannel({ id: CHANNEL_ID, name: '편집채널', member: true })
    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
    await stubMessages(page, CHANNEL_ID, [
      createMessage({ id: MSG_ID, channelId: CHANNEL_ID, authorId: ME_ID, authorName: '나', body: '원본' }),
    ])

    // PATCH /messaging/messages/{id} — editedAt 채워 반환 → (수정됨) 배지 노출.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/messages/${MSG_ID}`,
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback()
        const payload = route.request().postDataJSON() as { body: string }
        expect(payload.body).toBe('원본 수정됨')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createMessage({
              id: MSG_ID,
              channelId: CHANNEL_ID,
              authorId: ME_ID,
              authorName: '나',
              body: '원본 수정됨',
              editedAt: new Date('2026-06-02T01:00:00Z').toISOString(),
            }),
          ),
        })
      },
    )

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId(`message-body-${MSG_ID}`)).toHaveText('원본')

    // toolbar 는 group-hover 로만 노출 → 반드시 hover 후 클릭.
    await page.getByTestId(`message-${MSG_ID}`).hover()
    await page.getByTestId(`message-edit-${MSG_ID}`).click()

    // 인라인 에디터에서 본문 변경(append). 변경 없으면 submit 이 no-op 이라 PATCH 미발생.
    await page.getByTestId(`message-editor-input-${MSG_ID}`).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' 수정됨')
    await page.getByTestId(`message-editor-save-${MSG_ID}`).click()

    await expect(page.getByTestId(`message-edited-${MSG_ID}`)).toBeVisible()
    // 본문 컨테이너엔 본문 텍스트 + 인라인 (수정됨) 표식이 함께 들어가므로 부분 일치로 검증.
    // ((수정됨) 가시성은 위 message-edited 단언이 담당)
    await expect(page.getByTestId(`message-body-${MSG_ID}`)).toContainText('원본 수정됨')

    // DELETE /messaging/messages/{id} — 204 → 캐시에서 deleted=true, (삭제됨) 마스킹.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/messages/${MSG_ID}`,
      (route) =>
        route.request().method() === 'DELETE'
          ? route.fulfill({ status: 204 })
          : route.fallback(),
    )

    await page.getByTestId(`message-${MSG_ID}`).hover()
    await page.getByTestId(`message-delete-${MSG_ID}`).click()
    await expect(page.getByTestId(`message-body-${MSG_ID}`)).toHaveText('(삭제됨)')
  })

  // 3) unread 배지: 사이드바에 unread>0 배지 → SSE read 이벤트(본인) 로 목록 invalidate
  //    → 재조회가 unreadCount:0 반환 → 배지 사라짐.
  //    레이스 회피: SSE read 이벤트를 mount 즉시 흘리지 않고, 배지가 화면에 뜬 것을 확인한
  //    뒤 테스트가 트리거(window 플래그)를 세팅하면 그때 스트림이 read 이벤트를 fulfill 한다.
  test('사이드바 unread 배지가 읽음 처리 후 사라진다', async ({ authenticatedPage: page }) => {
    const CHANNEL_ID = 202
    // /messaging/channels 호출 카운터 — 1번째는 unread=3, 이후는 0.
    let listCalls = 0
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        listCalls += 1
        const unreadCount = listCalls === 1 ? 3 : 0
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            createChannel({ id: CHANNEL_ID, name: '안읽음채널', member: true, unreadCount }),
          ]),
        })
      },
    )
    await stubDmsList(page)

    // 스트림 — 테스트가 window.__emitRead 플래그를 세팅할 때까지 대기 후 본인 read 이벤트 fulfill.
    // 이로써 "배지 노출 → read → 배지 사라짐" 순서가 결정적으로 보장된다.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      async (route) => {
        await page.waitForFunction(() => (window as unknown as { __emitRead?: boolean }).__emitRead === true)
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body:
            `event: messaging.message.read\n` +
            `data: ${JSON.stringify({ channelId: CHANNEL_ID, userId: ME_ID, lastReadMessageId: 999 })}\n\n`,
        })
      },
    )

    await page.goto('/chat')

    // 1) 초기 목록(call 1) → unread 배지 노출.
    await expect(page.getByTestId(`channel-unread-${CHANNEL_ID}`)).toBeVisible()
    await expect(page.getByTestId(`channel-unread-${CHANNEL_ID}`)).toHaveText('3')

    // 2) 트리거 세팅 → 스트림이 read 이벤트 fulfill → invalidate → 재조회(call 2, unread=0) → 배지 사라짐.
    await page.evaluate(() => {
      ;(window as unknown as { __emitRead?: boolean }).__emitRead = true
    })
    await expect(page.getByTestId(`channel-unread-${CHANNEL_ID}`)).toHaveCount(0)
  })
})
