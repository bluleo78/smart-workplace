// WP-62 — 채널 생성·멤버 제거(resource.changed channel)가 새로고침 없이 사이드바·상세에 반영되는지 E2E.
// /api/v1/events 를 게이트 모킹해 프레임을 첫 렌더 뒤에 흘려보내고, 재조회로 화면이 바뀌는지 본다.
import type { Page } from '@playwright/test';

import { createChannel } from '../../factories/messaging.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { mockGatedEvents, resourceChangedFrame } from '../../fixtures/gatedEvents';

type Channel = ReturnType<typeof createChannel>;

// 채널 목록·상세(GET) 스텁 — 상태는 테스트가 직접 바꾼다. 상세는 목록에 없으면 404(제거된 사용자 재현).
async function stubChannels(page: Page, getStore: () => Channel[]) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(getStore()) });
    },
  );
  await page.route(
    (url) => /^\/api\/v1\/messaging\/channels\/\d+$/.test(url.pathname),
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const id = Number(new URL(route.request().url()).pathname.split('/').pop());
      const found = getStore().find((c) => c.id === id);
      if (!found) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(found) });
    },
  );
  await page.route(
    (url) => /^\/api\/v1\/messaging\/channels\/\d+\/messages$/.test(url.pathname),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
          })
        : route.fallback(),
  );
}

test.describe('채널 변경 실시간 반영 (WP-62)', () => {
  test('채널 생성 — 사이드바에 새 채널이 나타난다', async ({ authenticatedPage: page }) => {
    let store = [createChannel({ id: 1, name: '일반' })];
    await stubChannels(page, () => store);
    const events = await mockGatedEvents(page);

    await page.goto('/chat');
    await expect(page.getByTestId('channel-link-1')).toBeVisible();
    await expect(page.getByTestId('channel-link-9')).toHaveCount(0);

    store = [...store, createChannel({ id: 9, name: 'ai-채널' })];
    events.deliver(resourceChangedFrame({ resource: 'channel', op: 'created', scopeType: 'TENANT', scopeId: 1, channelId: 9, actorId: 99 }));

    await expect(page.getByTestId('channel-link-9')).toContainText('ai-채널');
  });

  test('제거된 사용자 — 사이드바에서 사라지고 상세는 not-found, 로그인으로 튕기지 않는다', async ({
    authenticatedPage: page,
  }) => {
    let store = [createChannel({ id: 1, name: '일반' }), createChannel({ id: 5, name: '비밀', visibility: 'PRIVATE' })];
    await stubChannels(page, () => store);
    const events = await mockGatedEvents(page);

    await page.goto('/chat/channels/5');
    await expect(page.getByTestId('channel-header-name')).toContainText('비밀');
    await expect(page.getByTestId('channel-link-5')).toBeVisible();

    store = store.filter((c) => c.id !== 5);
    events.deliver(resourceChangedFrame({ resource: 'channel', op: 'updated', scopeType: 'CHANNEL', scopeId: 5, channelId: 5, actorId: 99 }));

    await expect(page.getByTestId('channel-link-5')).toHaveCount(0);
    await expect(page.getByTestId('channel-not-found')).toBeVisible();
    await expect(page.getByTestId('channel-link-1')).toBeVisible();
    await expect(page).not.toHaveURL(/login/);
  });
});
