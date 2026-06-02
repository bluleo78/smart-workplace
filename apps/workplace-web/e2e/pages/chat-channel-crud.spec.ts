// messaging 채널 CRUD/탐색 E2E — 백엔드 없이 page.route() 모킹.
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/auth.fixture';
import { createChannel } from '../factories/messaging.factory';

// 사이드바가 부르는 GET /channels(내 채널) + SSE stub. 메시지 GET 은 빈 목록.
async function stubSidebar(page: Page, channels: ReturnType<typeof createChannel>[]) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(channels),
      });
    },
  );
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: ':\n\n',
      }),
  );
}

test.describe('messaging 채널 생성', () => {
  test('공개 채널 생성 → 새 채널로 이동', async ({ authenticatedPage: page }) => {
    await stubSidebar(page, []);

    // POST /channels — payload 검증 후 201 신규 채널.
    const created = createChannel({ id: 7, name: '신규채널', visibility: 'PUBLIC', role: 'OWNER' });
    const post = await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const payload = route.request().postDataJSON() as { name: string; visibility: string };
        expect(payload).toEqual({ name: '신규채널', visibility: 'PUBLIC' });
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
      },
    );
    void post;
    // 생성 후 이동할 채널의 메시지/상세 stub.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/7/messages',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
            })
          : route.fallback(),
    );
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/7',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(created),
            })
          : route.fallback(),
    );

    await page.goto('/chat');
    await page.getByTestId('channel-create-btn').click();
    await page.getByTestId('create-channel-name').fill('신규채널');
    await page.getByTestId('create-channel-submit').click();

    // 새 채널로 라우팅됨 → 헤더에 채널명.
    await expect(page).toHaveURL(/\/chat\/channels\/7$/);
  });

  test('비공개 토글 → visibility=PRIVATE 페이로드', async ({ authenticatedPage: page }) => {
    await stubSidebar(page, []);
    const created = createChannel({ id: 8, name: '비밀', visibility: 'PRIVATE', role: 'OWNER' });
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const payload = route.request().postDataJSON() as { name: string; visibility: string };
        expect(payload).toEqual({ name: '비밀', visibility: 'PRIVATE' });
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
      },
    );
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/8',
      (route) => route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) })
        : route.fallback(),
    );
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/8/messages',
      (route) => route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }) })
        : route.fallback(),
    );

    await page.goto('/chat');
    await page.getByTestId('channel-create-btn').click();
    await page.getByTestId('create-channel-name').fill('비밀');
    await page.getByTestId('create-channel-visibility-private').click();
    await page.getByTestId('create-channel-submit').click();
    await expect(page).toHaveURL(/\/chat\/channels\/8$/);
  });

  test('비공개 채널은 사이드바에 자물쇠로 표시', async ({ authenticatedPage: page }) => {
    const priv = createChannel({ id: 9, name: '비공개방', visibility: 'PRIVATE', member: true });
    await stubSidebar(page, [priv]);
    await page.goto('/chat');
    await expect(page.getByTestId('channel-lock-9')).toBeVisible();
  });
});

test.describe('messaging 채널 탐색·참여', () => {
  test('탐색 모달 → 검색 결과 → 참여 → 목록 무효화', async ({ authenticatedPage: page }) => {
    // 사이드바: 처음엔 내 채널 없음. 참여 후 GET /channels 가 새 채널 포함하도록 토글.
    let joined = false
    const target = createChannel({ id: 30, name: '공개방', visibility: 'PUBLIC', member: false, role: null })
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        const body = joined ? [{ ...target, member: true, role: 'MEMBER' }] : []
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      },
    )
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: ':\n\n' }),
    )
    // GET /channels/discover — 검색 결과.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/discover',
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([target]) })
      },
    )
    // POST /channels/30/join — 204 + 이후 사이드바 반영 토글.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/30/join',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        joined = true
        return route.fulfill({ status: 204 })
      },
    )

    await page.goto('/chat')
    await page.getByTestId('channel-browse-btn').click()
    await expect(page.getByTestId('channel-browser')).toBeVisible()
    await page.getByTestId('channel-browser-join-30').click()
    // 참여 후 사이드바에 등장.
    await expect(page.getByTestId('channel-link-30')).toBeVisible()
  })
})
