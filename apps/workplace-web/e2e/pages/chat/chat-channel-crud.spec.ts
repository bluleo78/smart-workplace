// messaging 채널 상세 E2E — 실제 화면 폭에서 긴 채널명 잘림·헤더 높이, 보관 공개 채널 비멤버의 읽음 요청 부재(실제 화면에 보이는
// 메시지로만 읽음 표시가 나가 jsdom 에선 판정이 거짓으로 통과한다)만 남긴다(@layout). 백엔드 없이 page.route() 모킹.
// 채널 만들기·탐색·자물쇠·이름 변경·409·설정 권한·404·보관 툴바·삭제는 vitest 로 옮겼다(WP-984):
// src/pages/chat/channelSidebar.test.tsx · channelPage.test.tsx.
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createChannel, createMessage } from '../../factories/messaging.factory';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';

// 채널 상세(헤더·아카이브·404) E2E — stubChannelView 로 공통 라우트 설정.
async function stubChannelView(
  page: Page,
  channel: ReturnType<typeof createChannel>,
  status = 200,
  messages: ReturnType<typeof createMessage>[] = [],
) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([channel]) })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: ':\n\n' }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return status === 200
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
        : route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ message: '채널을 찾을 수 없습니다' }) })
    },
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: messages, nextCursor: null, hasMore: false }) })
        : route.fallback(),
  )
}

test.describe('messaging 채널 헤더·아카이브', () => {
  // WP-621: 보관된 공개 채널은 멤버가 아니어도(나간 사람) 메시지를 읽기 전용으로 본다 — 읽음 표시 요청은 보내지 않는다(멤버 전용 API).
  test('보관된 공개 채널 비멤버 → 메시지가 보이고 입력 대신 보관 안내, 읽음 요청은 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const archived = createChannel({ id: 49, name: '보관공개', visibility: 'PUBLIC', archived: true, role: null, member: false })
    const msg = createMessage({ id: 490, channelId: 49, body: '보관 전 결정 사항' })
    await stubChannelView(page, archived, 200, [msg])
    const reads = trackRequests(page, 'POST', '/api/v1/messaging/channels/49/read')
    await page.goto('/chat/channels/49')
    await expect(page.getByTestId('message-body-490')).toHaveText('보관 전 결정 사항')
    await expect(page.getByText('이 채널은 보관되었습니다')).toBeVisible()
    await expect(page.getByTestId('message-composer-input')).toHaveCount(0)
    // 채널 파일(연동 드라이브)은 멤버 전용이라 비멤버 열람자에겐 버튼이 없다.
    await expect(page.getByTestId('channel-files-button')).toHaveCount(0)
    await expectStays(page, () => reads.count(), 0, { message: '비멤버는 읽음 표시 요청을 보내지 않는다' })
  })

  test('긴 채널명 — truncate 적용 + 헤더 높이 고정 (이슈 #797)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    // 채널명이 매우 길면 <h1> 이 줄바꿈되며 h-14 고정 높이가 깨지던 회귀(#797).
    const longName = '가'.repeat(80)
    const ch = createChannel({ id: 46, name: longName, role: 'OWNER', member: true })
    await stubChannelView(page, ch)
    await page.goto('/chat/channels/46')

    const header = page.getByTestId('channel-header')
    const title = page.getByTestId('channel-header-name')
    await expect(title).toBeVisible()

    // 헤더 컨테이너가 h-14 로 고정된 채 유지되어야 한다 — 2줄로 줄바꿈되면 clientHeight 가 56px 를 초과한다.
    await expect
      .poll(async () => header.evaluate((el) => el.clientHeight))
      .toBeLessThanOrEqual(56)

    // 제목 요소 자체는 1줄로 잘려야 한다 — scrollWidth 가 clientWidth 를 넘어서면 truncate 미적용.
    const isTruncated = await title.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(isTruncated).toBe(true)

    // hover 시 전체 이름 확인 가능하도록 title 속성 보강.
    await expect(title).toHaveAttribute('title', longName)

    // 우측 고정 그룹(멤버·파일·설정)이 여전히 헤더 안에 보여야 한다 — 두 번째 줄로 밀리지 않음.
    await expect(page.getByTestId('channel-members-btn')).toBeVisible()
    await expect(page.getByTestId('channel-files-button')).toBeVisible()
  })
})
