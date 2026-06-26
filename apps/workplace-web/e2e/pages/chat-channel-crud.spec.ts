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
    (url) => url.pathname === '/api/v1/events',
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
      (url) => url.pathname === '/api/v1/events',
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

// 채널 상세(헤더·아카이브·404) E2E — stubChannelView 로 공통 라우트 설정.
async function stubChannelView(
  page: Page,
  channel: ReturnType<typeof createChannel>,
  status = 200,
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
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }) })
        : route.fallback(),
  )
}

test.describe('messaging 채널 헤더·아카이브', () => {
  test('아카이브 채널 → composer 비활성 + 안내', async ({ authenticatedPage: page }) => {
    const archived = createChannel({ id: 40, name: '보관됨', archived: true, role: 'OWNER', member: true })
    await stubChannelView(page, archived)
    await page.goto('/chat/channels/40')
    await expect(page.getByTestId('channel-archived-badge')).toBeVisible()
    // Phase 4: 컴포저가 contenteditable(RichInput) 로 바뀌어, 보관 채널은 입력기를
    // 비활성 표시하는 대신 아예 마운트하지 않고 안내 문구만 렌더한다.
    await expect(page.getByTestId('message-composer-input')).toHaveCount(0)
    await expect(page.getByText('이 채널은 보관되었습니다')).toBeVisible()
  })

  test('OWNER → 설정에서 이름 변경', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: 41, name: '구이름', role: 'OWNER', member: true })
    await stubChannelView(page, ch)
    // PATCH 후 GET 이 새 이름을 반환하도록 토글.
    let renamed = false
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/41',
      (route) => {
        if (route.request().method() === 'PATCH') {
          const payload = route.request().postDataJSON() as { name: string }
          expect(payload).toEqual({ name: '새이름' })
          renamed = true
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...ch, name: '새이름' }) })
        }
        if (route.request().method() === 'GET') {
          const body = renamed ? { ...ch, name: '새이름' } : ch
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
        }
        return route.fallback()
      },
    )
    await page.goto('/chat/channels/41')
    await page.getByTestId('channel-settings-btn').click()
    await page.getByTestId('channel-rename-action').click()
    await page.getByTestId('rename-channel-name').fill('새이름')
    await page.getByTestId('rename-channel-submit').click()
    await expect(page.getByTestId('channel-header-name')).toHaveText('새이름')
  })

  test('MEMBER 에게는 설정 버튼 미노출', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: 42, name: '일반방', role: 'MEMBER', member: true })
    await stubChannelView(page, ch)
    await page.goto('/chat/channels/42')
    await expect(page.getByTestId('channel-header')).toBeVisible()
    await expect(page.getByTestId('channel-settings-btn')).toHaveCount(0)
  })

  test('비공개 비멤버 접근(404) → 채널 없음', async ({ authenticatedPage: page }) => {
    const ghost = createChannel({ id: 43, name: '비밀', visibility: 'PRIVATE' })
    await stubChannelView(page, ghost, 404)
    await page.goto('/chat/channels/43')
    await expect(page.getByTestId('channel-not-found')).toBeVisible()
  })

  test('채널 헤더 h-14 정렬 + 설정 드롭다운 동작', async ({ authenticatedPage: page }) => {
    // OWNER 권한 채널 진입 — stubChannelView 재사용.
    const ch = createChannel({ id: 45, name: '헤더테스트', role: 'OWNER', member: true })
    await stubChannelView(page, ch)
    await page.goto('/chat/channels/45')

    // h-14 클래스 확인.
    const header = page.getByTestId('channel-header')
    await expect(header).toHaveClass(/h-14/)
    await expect(page.getByTestId('channel-header-name')).toBeVisible()
    // 채널명이 a11y heading(level 1)으로 노출돼야 한다 — span 이 아니라 h1 (refs #121).
    await expect(header.getByRole('heading', { level: 1, name: '헤더테스트' })).toBeVisible()

    // 설정 드롭다운이 열리고 이름변경 항목이 보임 — 기능 회귀 없음 확인.
    await page.getByTestId('channel-settings-btn').click()
    await expect(page.getByTestId('channel-rename-action')).toBeVisible()
  })

  test('채널 삭제 확인 버튼 — destructive 스타일 적용 (이슈 #142)', async ({ adminPage: page }) => {
    // 파괴적 작업 버튼이 기본 파란색(primary)이 아닌 빨간색(destructive)으로 표시되어야 함
    const ch = createChannel({ id: 44, name: '삭제대상', role: 'MEMBER', member: true })
    await stubChannelView(page, ch)
    await page.goto('/chat/channels/44')
    await page.getByTestId('channel-settings-btn').click()
    await page.getByTestId('channel-delete-action').click()
    // AlertDialog 확인 버튼에 bg-destructive 클래스가 있어야 함 (primary 아님)
    const confirmBtn = page.getByTestId('channel-delete-confirm')
    await expect(confirmBtn).toBeVisible()
    await expect(confirmBtn).toHaveClass(/bg-destructive/)
  })

  test('시스템 ADMIN → 채널 삭제 → /chat 이동', async ({ adminPage: page }) => {
    const ch = createChannel({ id: 44, name: '삭제대상', role: 'MEMBER', member: true })
    await stubChannelView(page, ch)
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/44',
      (route) => (route.request().method() === 'DELETE' ? route.fulfill({ status: 204 }) : route.fallback()),
    )
    await page.goto('/chat/channels/44')
    await page.getByTestId('channel-settings-btn').click()
    await page.getByTestId('channel-delete-action').click()
    // AlertDialog 확인 버튼.
    await page.getByTestId('channel-delete-confirm').click()
    await expect(page).toHaveURL(/\/chat$/)
  })
})
