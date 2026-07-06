// messaging Phase 5 E2E — 스레드 답글(패널·replyCount) · 이모지 리액션(토글·payload·pill).
// 백엔드 없이 page.route() 로 모든 API 모킹. 컴포저는 contenteditable(RichInput/TipTap).
import type { Page } from '@playwright/test'

import {
  createChannel,
  createChannelMember,
  createMessage,
  createReaction,
} from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'

// auth.fixture 의 createUser() 기본 id = 1 → "본인" 메시지 판정 기준.
const ME_ID = 1

// 채널 목록 GET stub.
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

// DM 목록 GET stub.
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
    (url) => url.pathname === '/api/v1/events',
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

// 스레드 답글 GET stub.
async function stubReplies(
  page: Page,
  parentId: number,
  items: ReturnType<typeof createMessage>[],
) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/messages/${parentId}/replies`,
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

test.describe('messaging Phase 5 — 스레드·리액션', () => {
  // 1) 스레드: 답글수 링크 클릭 → 패널 → 답글 작성 → payload.parentMessageId 검증 + 패널 표시.
  test(
    '답글을 작성하면 parentMessageId 가 전송되고 스레드 패널에 보인다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const CHANNEL_ID = 500
      const PARENT_ID = 9001
      const channel = createChannel({ id: CHANNEL_ID, name: '스레드채널' })
      const parent = createMessage({ id: PARENT_ID, channelId: CHANNEL_ID, body: '부모글', replyCount: 1 })

      await stubChannelsList(page, [channel])
      await stubDmsList(page)
      await stubStream(page)
      await stubChannelDetail(page, channel)
      await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
      await stubMessages(page, CHANNEL_ID, [parent])
      await stubReplies(page, PARENT_ID, [
        createMessage({ id: 9100, channelId: CHANNEL_ID, parentMessageId: PARENT_ID, body: '기존답글' }),
      ])

      // POST 답글 — parentMessageId 캡처.
      let sentParent: number | undefined
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
        (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          const body = route.request().postDataJSON() as { body: string; parentMessageId?: number }
          sentParent = body.parentMessageId
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(
              createMessage({
                id: 9101,
                channelId: CHANNEL_ID,
                parentMessageId: PARENT_ID,
                authorId: ME_ID,
                authorName: '나',
                body: body.body,
              }),
            ),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)
      // 답글수 링크 → 패널 오픈(replyCount=1 이므로 thread-link 가 렌더된다).
      await page.getByTestId(`message-thread-link-${PARENT_ID}`).click()
      await expect(page.getByTestId('thread-panel')).toBeVisible()
      await expect(page.getByTestId('message-9100')).toBeVisible() // 기존 답글

      // 패널 컴포저에 입력 후 전송(RichInput contenteditable).
      const composer = page.getByTestId('thread-panel').getByTestId('message-composer-input')
      await composer.click()
      await composer.fill('새 답글')
      await page.getByTestId('thread-panel').getByTestId('message-composer-submit').click()

      expect(sentParent).toBe(PARENT_ID)
      await expect(page.getByTestId('message-9101')).toContainText('새 답글')
    },
  )

  // 2) 리액션: hover → 트리거 클릭 → 팝오버 퀵셋 클릭 → POST payload.emoji 검증 → pill 낙관적 표시.
  test(
    '퀵셋 이모지를 누르면 emoji payload 가 전송되고 pill 이 표시된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const CHANNEL_ID = 501
      const MSG_ID = 9200
      const channel = createChannel({ id: CHANNEL_ID, name: '리액션채널' })
      const msg = createMessage({ id: MSG_ID, channelId: CHANNEL_ID, body: '반응해줘' })

      await stubChannelsList(page, [channel])
      await stubDmsList(page)
      await stubStream(page)
      await stubChannelDetail(page, channel)
      await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
      await stubMessages(page, CHANNEL_ID, [msg])

      let sentEmoji: string | undefined
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/messages/${MSG_ID}/reactions`,
        (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          sentEmoji = (route.request().postDataJSON() as { emoji: string }).emoji
          return route.fulfill({ status: 204, body: '' })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)
      // group-hover 영역 노출을 위해 hover 필수.
      await page.getByTestId(`message-${MSG_ID}`).hover()
      // 이모지 피커 트리거(-react) → 팝오버 → 퀵셋 클릭.
      await page.getByTestId(`message-${MSG_ID}-react`).click()
      await page.getByTestId(`message-${MSG_ID}-quick-👍`).click()

      expect(sentEmoji).toBe('👍')
      // 낙관적 pill 표시 + count 1.
      await expect(page.getByTestId(`reaction-pill-${MSG_ID}-👍`)).toBeVisible()
      await expect(page.getByTestId(`reaction-count-${MSG_ID}-👍`)).toHaveText('1')
    },
  )

  // 3) 리액션 토글 off: reacted pill 클릭 → DELETE 호출 + pill 제거.
  test('이미 누른 리액션을 다시 누르면 DELETE 되고 pill 이 사라진다', async ({
    authenticatedPage: page,
  }) => {
    const CHANNEL_ID = 502
    const MSG_ID = 9300
    const channel = createChannel({ id: CHANNEL_ID, name: '토글채널' })
    const msg = createMessage({
      id: MSG_ID,
      channelId: CHANNEL_ID,
      body: '눌림',
      reactions: [createReaction({ emoji: '🎉', count: 1, reacted: true })],
    })

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
    await stubMessages(page, CHANNEL_ID, [msg])

    let deleted = false
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/messages/${MSG_ID}/reactions`,
      (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback()
        deleted = true
        return route.fulfill({ status: 204, body: '' })
      },
    )

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId(`reaction-pill-${MSG_ID}-🎉`)).toBeVisible()
    await page.getByTestId(`reaction-pill-${MSG_ID}-🎉`).click()

    expect(deleted).toBe(true)
    await expect(page.getByTestId(`reaction-pill-${MSG_ID}-🎉`)).toHaveCount(0)
  })

  // 3.5) 회귀(#702): 같은 이모지를 짧은 시간 안에 연속 클릭해도(더블/트리플 클릭 등)
  //      클라이언트 캐시 카운트가 클릭 횟수만큼 누적되지 않는다. stale-closure 버그라면
  //      매 클릭이 클릭 시점 렌더 클로저의 stale reactions 를 참조해 전부 "add" 로 오판,
  //      카운트가 0→1→2→3 으로 누적된 채 새로고침 전까지 영구 desync 된다.
  test('리액션을 짧은 시간 안에 연속 클릭해도 카운트가 누적되지 않는다', async ({
    authenticatedPage: page,
  }) => {
    const CHANNEL_ID = 505
    const MSG_ID = 9500
    const channel = createChannel({ id: CHANNEL_ID, name: '연속클릭채널' })
    const msg = createMessage({ id: MSG_ID, channelId: CHANNEL_ID, body: '연속클릭 테스트' })

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
    await stubMessages(page, CHANNEL_ID, [msg])

    let postCount = 0
    let deleteCount = 0
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/messages/${MSG_ID}/reactions`,
      (route) => {
        if (route.request().method() === 'POST') {
          postCount += 1
          return route.fulfill({ status: 204, body: '' })
        }
        if (route.request().method() === 'DELETE') {
          deleteCount += 1
          return route.fulfill({ status: 204, body: '' })
        }
        return route.fallback()
      },
    )

    await page.goto(`/chat/channels/${CHANNEL_ID}`)

    // hover 로 툴바 노출 → 이모지 추가 팝오버 오픈.
    await page.getByTestId(`message-${MSG_ID}`).hover()
    await page.getByTestId(`message-${MSG_ID}-react`).click()
    const quickBtn = page.getByTestId(`message-${MSG_ID}-quick-🎉`)
    await expect(quickBtn).toBeVisible()

    // 같은 틱 안에서 3연속 클릭(실제 더블/트리플 클릭 재현) — .evaluate() 로 playwright
    // actionability 대기 없이 동기적으로 3번 click() 을 흘려 렌더 사이 유예 없이 호출한다.
    await quickBtn.evaluate((el: HTMLElement) => {
      el.click()
      el.click()
      el.click()
    })

    // add→remove→add 로 alternate 되어 최종 pill 은 count=1 로 남아야 한다.
    // 누적 버그(stale closure)라면 매 클릭이 add 로 오판되어 count=3 으로 표시된다.
    await expect(page.getByTestId(`reaction-pill-${MSG_ID}-🎉`)).toBeVisible()
    await expect(page.getByTestId(`reaction-count-${MSG_ID}-🎉`)).toHaveText('1')
    expect(postCount).toBe(2)
    expect(deleteCount).toBe(1)
  })

  // 4) SSE 리액션: 타인이 누른 reaction.added 이벤트를 스트림으로 흘리면 pill 이 생긴다.
  //    userId=2 (≠ ME_ID=1) 이므로 self-echo 가드를 통과해 패치가 적용된다.
  test('SSE reaction.added 수신 시 pill 이 증가한다', async ({ authenticatedPage: page }) => {
    const CHANNEL_ID = 503
    const MSG_ID = 9400
    const channel = createChannel({ id: CHANNEL_ID, name: 'SSE채널' })
    const msg = createMessage({ id: MSG_ID, channelId: CHANNEL_ID, body: '실시간' })

    // 스트림 body 로 다른 유저(userId=2)의 reaction.added 이벤트를 흘린다.
    const sse =
      `event: messaging.reaction.added\n` +
      `data: ${JSON.stringify({ channelId: CHANNEL_ID, messageId: MSG_ID, emoji: '🔥', userId: 2 })}\n\n`

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page, sse)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
    await stubMessages(page, CHANNEL_ID, [msg])

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    // 스트림 이벤트 적용 후 pill 등장.
    await expect(page.getByTestId(`reaction-pill-${MSG_ID}-🔥`)).toBeVisible()
    await expect(page.getByTestId(`reaction-count-${MSG_ID}-🔥`)).toHaveText('1')
  })

  // 6) 회귀: 스레드 패널 내 답글 수정 시 thread 캐시가 갱신돼 UI 에 수정된 본문이 보인다.
  //    useUpdateMessage.onSuccess 가 thread 캐시를 patch 하지 않으면 이 테스트는 FAIL 한다.
  test(
    '스레드 패널에서 내 답글을 수정하면 패널 내 본문이 갱신된다(thread 캐시 패치 회귀)',
    async ({ authenticatedPage: page }) => {
      const CHANNEL_ID = 505
      const PARENT_ID = 9600
      const REPLY_ID = 9601
      const EDITED_BODY = '수정된 답글'
      const channel = createChannel({ id: CHANNEL_ID, name: '수정회귀채널' })
      const parent = createMessage({
        id: PARENT_ID,
        channelId: CHANNEL_ID,
        body: '부모글',
        replyCount: 1,
      })
      const reply = createMessage({
        id: REPLY_ID,
        channelId: CHANNEL_ID,
        parentMessageId: PARENT_ID,
        authorId: ME_ID,
        authorName: '나',
        body: '원본 답글',
      })

      await stubChannelsList(page, [channel])
      await stubDmsList(page)
      await stubStream(page)
      await stubChannelDetail(page, channel)
      await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
      await stubMessages(page, CHANNEL_ID, [parent])
      await stubReplies(page, PARENT_ID, [reply])

      // PATCH /api/v1/messaging/messages/:replyId → 수정된 메시지 응답.
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/messages/${REPLY_ID}`,
        (route) =>
          route.request().method() === 'PATCH'
            ? route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(
                  createMessage({
                    id: REPLY_ID,
                    channelId: CHANNEL_ID,
                    parentMessageId: PARENT_ID,
                    authorId: ME_ID,
                    authorName: '나',
                    body: EDITED_BODY,
                    editedAt: new Date('2026-06-03T00:00:00Z').toISOString(),
                  }),
                ),
              })
            : route.fallback(),
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)
      // 답글수 링크 클릭 → 스레드 패널 오픈(replyCount=1 이므로 thread-link 가 렌더됨).
      await page.getByTestId(`message-thread-link-${PARENT_ID}`).click()
      const panel = page.getByTestId('thread-panel')
      await expect(panel).toBeVisible()

      // 스레드 패널 내 답글 hover → 수정 버튼 클릭(group-hover toolbar).
      await panel.getByTestId(`message-${REPLY_ID}`).hover()
      await panel.getByTestId(`message-edit-${REPLY_ID}`).click()

      // 인라인 에디터에 새 내용 입력 후 저장.
      await panel.getByTestId(`message-editor-input-${REPLY_ID}`).fill(EDITED_BODY)
      await panel.getByTestId(`message-editor-save-${REPLY_ID}`).click()

      // thread 캐시가 패치되면 패널 내 본문이 갱신된다.
      await expect(panel.getByTestId(`message-body-${REPLY_ID}`)).toContainText(EDITED_BODY)
    },
  )

  // 5) self-echo 답글: 내가 쓴 답글의 created self-echo 가 와도 replyCount 가 이중 카운트되지 않는다.
  //    useCreateReply.onMutate 는 replyCount 를 낙관적으로 bump 하지 않고,
  //    SSE created 이벤트가 bumpReplyCount 를 단 한 번 수행(+1). 결과: 정확히 1개.
  test('내 답글 self-echo 시 replyCount 가 정확히 1 증가한다(이중 카운트 없음)', async ({
    authenticatedPage: page,
  }) => {
    const CHANNEL_ID = 504
    const PARENT_ID = 9500
    const REPLY_ID = 9501
    const channel = createChannel({ id: CHANNEL_ID, name: 'echo채널' })
    const parent = createMessage({ id: PARENT_ID, channelId: CHANNEL_ID, body: '부모', replyCount: 0 })

    // POST 답글 → 서버가 REPLY_ID 로 응답 + 같은 메시지를 created self-echo 로 스트림에 흘린다.
    const sse =
      `event: messaging.message.created\n` +
      `data: ${JSON.stringify(
        createMessage({
          id: REPLY_ID,
          channelId: CHANNEL_ID,
          parentMessageId: PARENT_ID,
          authorId: ME_ID,
          authorName: '나',
          body: '내 답글',
        }),
      )}\n\n`

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    // React StrictMode 가 첫 SSE 연결을 abort 하므로 gate 패턴은 동작하지 않는다.
    // 대신: 초기 연결은 모두 즉시 heartbeat 반환 → 재연결이 ~1s 주기로 계속 시도.
    // 답글 제출 후 deliverEvent=true 를 세우면 다음 재연결에서 self-echo 이벤트를
    // 정확히 1회 발화한다. 이 시점에 messages 캐시가 이미 채워져 bumpReplyCount 가 동작.
    let deliverEvent = false
    await page.route(
      (url) => url.pathname === '/api/v1/events',
      (route) => {
        if (deliverEvent) {
          deliverEvent = false
          return route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            headers: { 'cache-control': 'no-cache' },
            body: sse,
          })
        }
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: `:\n\n`,
        })
      },
    )
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
    await stubMessages(page, CHANNEL_ID, [parent])
    await stubReplies(page, PARENT_ID, [])

    // POST 답글 응답.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(
            createMessage({
              id: REPLY_ID,
              channelId: CHANNEL_ID,
              parentMessageId: PARENT_ID,
              authorId: ME_ID,
              authorName: '나',
              body: '내 답글',
            }),
          ),
        })
      },
    )

    await page.goto(`/chat/channels/${CHANNEL_ID}`)

    // message-reply-{id} 는 group-hover 영역 → 반드시 hover 후 클릭.
    // parent.replyCount=0 이므로 message-thread-link-{PARENT_ID} 는 아직 없음 → reply 버튼으로 오픈.
    await page.getByTestId(`message-${PARENT_ID}`).hover()
    await page.getByTestId(`message-reply-${PARENT_ID}`).click()

    // 스레드 패널 오픈 확인.
    await expect(page.getByTestId('thread-panel')).toBeVisible()

    // 패널 컴포저로 답글 작성.
    const composer = page.getByTestId('thread-panel').getByTestId('message-composer-input')
    await composer.click()
    await composer.fill('내 답글')
    await page.getByTestId('thread-panel').getByTestId('message-composer-submit').click()

    // 답글 제출 후 플래그 활성화 → 다음 SSE 재연결에서 self-echo 이벤트를 정확히 1회 발화.
    deliverEvent = true

    // SSE self-echo 적용 후 "답글 1개" (2개 아님 — 이중 카운트 없음).
    await expect(page.getByTestId(`message-thread-link-${PARENT_ID}`)).toHaveText('답글 1개')
  })

  // 회귀 #291: 스레드 패널 — 답글 0건 시 빈 상태 메시지("아직 답글이 없어요.") 표시.
  test('스레드 패널 — 답글이 없을 때 빈 상태 메시지가 표시된다(#291 회귀)', async ({
    authenticatedPage: page,
  }) => {
    const CHANNEL_ID = 511
    const PARENT_ID = 9800
    const channel = createChannel({ id: CHANNEL_ID, name: '빈스레드채널' })
    const parent = createMessage({ id: PARENT_ID, channelId: CHANNEL_ID, body: '부모글', replyCount: 0 })

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
    await stubMessages(page, CHANNEL_ID, [parent])
    // 답글 0건 — emptyState 가 렌더돼야 한다.
    await stubReplies(page, PARENT_ID, [])

    await page.goto(`/chat/channels/${CHANNEL_ID}`)

    // replyCount=0 이므로 thread-link 없음 → reply 버튼으로 패널 오픈.
    await page.getByTestId(`message-${PARENT_ID}`).hover()
    await page.getByTestId(`message-reply-${PARENT_ID}`).click()
    await expect(page.getByTestId('thread-panel')).toBeVisible()

    // 빈 상태 안내 메시지가 표시돼야 한다.
    const panel = page.getByTestId('thread-panel')
    await expect(panel.getByText('아직 답글이 없어요.')).toBeVisible()
    await expect(panel.getByText('첫 번째 답글을 남겨보세요.')).toBeVisible()
  })

  // 회귀 #281: 리액션 활성 pill 이 raw 팔레트(bg-blue-100 등) 대신 시맨틱 토큰(bg-primary/10)을 사용한다.
  test('활성(reacted=true) 리액션 pill 이 시맨틱 토큰 클래스를 사용한다', async ({
    authenticatedPage: page,
  }) => {
    const CHANNEL_ID = 510
    const MSG_ID = 9700
    const channel = createChannel({ id: CHANNEL_ID, name: '리액션토큰채널' })
    const msg = createMessage({
      id: MSG_ID,
      channelId: CHANNEL_ID,
      body: '리액션 토큰 테스트',
      reactions: [createReaction({ emoji: '👍', count: 1, reacted: true })],
    })

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
    await stubMessages(page, CHANNEL_ID, [msg])

    await page.goto(`/chat/channels/${CHANNEL_ID}`)

    const pill = page.getByTestId(`reaction-pill-${MSG_ID}-👍`)
    await expect(pill).toBeVisible()

    // aria-pressed 로 활성 상태 확인.
    await expect(pill).toHaveAttribute('aria-pressed', 'true')

    // 시맨틱 토큰 클래스가 있어야 한다 (다크모드 자동 대응).
    await expect(pill).toHaveClass(/bg-primary\/10/)
    await expect(pill).toHaveClass(/text-primary/)
    await expect(pill).toHaveClass(/border-primary/)

    // raw 팔레트 클래스가 없어야 한다 (#281 회귀 방지).
    const cls = await pill.getAttribute('class')
    expect(cls).not.toContain('bg-blue-100')
    expect(cls).not.toContain('text-blue-700')
    expect(cls).not.toContain('border-blue-400')
  })
})
