// IssueActivityTimeline — STATUS_CHANGED/PRIORITY_CHANGED 한국어 매핑 회귀 테스트 (#157).
// 백엔드 영문 enum 원시값이 그대로 노출되지 않고 한국어 표시명으로 렌더되는지 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import {
  createAgentHistoryEntry,
  createHistoryEntry,
  createIssueDetail,
} from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';

// IssueDetailPage 가 동시에 fetch 하는 부수 endpoint 를 공통으로 stub.
async function setupCommonStubs(page: import('@playwright/test').Page) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
      ]),
    });
  });
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/watchers`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/labels`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    },
  );
}

test.describe('IssueActivityTimeline — 액터 보더 색상', () => {
  // #311 회귀: HUMAN 항목에 border-l-border, AGENT 항목에 border-l-ai-accent 가 적용되는지 검증
  test(
    'HUMAN 항목에는 border-l-border, AGENT 항목에는 border-l-ai-accent 보더 색상이 적용됨',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      const detail = createIssueDetail({
        history: [
          createHistoryEntry({ id: 1, actorKind: 'HUMAN', actorName: '사람 사용자' }),
          createAgentHistoryEntry({ id: 2 }),
        ],
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();

      // HUMAN 항목: border-l-border 클래스가 있어야 함 (투명 보더 방지)
      // data-agent 속성이 없는 li = HUMAN 항목
      const humanItem = timeline.locator('li:not([data-agent])').first();
      await expect(humanItem).toHaveClass(/border-l-border/);

      // AGENT 항목: border-l-ai-accent 클래스가 있어야 함
      const agentItem = timeline.locator('li[data-agent="true"]').first();
      await expect(agentItem).toHaveClass(/border-l-ai-accent/);
    },
  );
});

test.describe('IssueActivityTimeline 날짜 포맷 (#320)', () => {
  test(
    '활동 타임라인 날짜가 초 없이 분 단위(YYYY-MM-DD HH:mm)로 표시된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      // UTC 타임스탬프(Z 포함) → parseUtcDate 경유 → formatDateTimeMinute → "YYYY-MM-DD HH:mm"
      const fixedDate = '2026-06-07T00:22:52Z';
      const detail = createIssueDetail({
        history: [
          createHistoryEntry({
            id: 20,
            actorKind: 'HUMAN',
            actorName: '사람 사용자',
            createdAt: fixedDate,
          }),
        ],
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();

      const item = timeline.locator('li').first();

      // 초 단위 포함 패턴(HH:MM:SS)이 없어야 함 — toLocaleString('ko-KR') 잔재 방지
      await expect(item).not.toContainText(/\d{1,2}:\d{2}:\d{2}/);
      // YYYY-MM-DD HH:mm 형식이어야 함
      await expect(item).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    },
  );
});

test.describe('IssueActivityTimeline — 한국어 enum 매핑', () => {
  test(
    'STATUS_CHANGED 이벤트: TODO→IN_PROGRESS 가 "할 일 → 진행 중" 으로 표시됨',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      const detail = createIssueDetail({
        history: [
          createHistoryEntry({
            id: 1,
            eventType: 'STATUS_CHANGED',
            fromValue: 'TODO',
            toValue: 'IN_PROGRESS',
          }),
        ],
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      // 활동 타임라인 섹션 대기
      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();

      // 영문 enum 원시값 노출 없어야 함
      await expect(timeline).not.toContainText('TODO');
      await expect(timeline).not.toContainText('IN_PROGRESS');

      // 한국어 표시명이 렌더되어야 함
      await expect(timeline).toContainText('할 일 → 진행 중');
    },
  );

  test(
    'STATUS_CHANGED 이벤트: 여러 상태값(DONE, CANCELED) 한국어 매핑 검증',
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      const detail = createIssueDetail({
        history: [
          createHistoryEntry({
            id: 2,
            eventType: 'STATUS_CHANGED',
            fromValue: 'IN_PROGRESS',
            toValue: 'DONE',
          }),
          createHistoryEntry({
            id: 3,
            eventType: 'STATUS_CHANGED',
            fromValue: 'DONE',
            toValue: 'CANCELED',
          }),
        ],
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();

      await expect(timeline).not.toContainText('IN_PROGRESS');
      await expect(timeline).not.toContainText('DONE');
      await expect(timeline).not.toContainText('CANCELED');

      await expect(timeline).toContainText('진행 중 → 완료');
      await expect(timeline).toContainText('완료 → 취소');
    },
  );

  test(
    'PRIORITY_CHANGED 이벤트: LOW→HIGH 가 "낮음 → 높음" 으로 표시됨',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      const detail = createIssueDetail({
        history: [
          createHistoryEntry({
            id: 4,
            eventType: 'PRIORITY_CHANGED',
            fromValue: 'LOW',
            toValue: 'HIGH',
          }),
        ],
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();

      await expect(timeline).not.toContainText('LOW');
      await expect(timeline).not.toContainText('HIGH');

      await expect(timeline).toContainText('낮음 → 높음');
    },
  );

  test(
    'PRIORITY_CHANGED 이벤트: MID 값이 "보통" 으로 표시됨',
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      const detail = createIssueDetail({
        history: [
          createHistoryEntry({
            id: 5,
            eventType: 'PRIORITY_CHANGED',
            fromValue: 'MID',
            toValue: 'HIGH',
          }),
        ],
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();

      await expect(timeline).not.toContainText('MID');
      await expect(timeline).toContainText('보통 → 높음');
    },
  );

  test(
    '이벤트 유형별 아이콘이 각 타임라인 항목에 렌더됨 (회귀 #313)',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      const detail = createIssueDetail({
        history: [
          createHistoryEntry({
            id: 10,
            eventType: 'STATUS_CHANGED',
            fromValue: 'TODO',
            toValue: 'IN_PROGRESS',
          }),
          createHistoryEntry({
            id: 11,
            eventType: 'ASSIGNEES_CHANGED',
            fromValue: null,
            toValue: JSON.stringify({ added: [{ id: 1, name: '홍길동' }], removed: [] }),
          }),
          createHistoryEntry({
            id: 12,
            eventType: 'LABELS_CHANGED',
            fromValue: null,
            toValue: JSON.stringify({ added: [{ name: 'bug' }], removed: [] }),
          }),
        ],
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();

      // 각 항목에 svg 아이콘이 렌더되어야 함 (이벤트 유형별 아이콘 #313)
      const items = timeline.locator('li');
      await expect(items).toHaveCount(3);

      // 모든 항목에 aria-hidden svg 아이콘이 있어야 함
      for (let i = 0; i < 3; i++) {
        const item = items.nth(i);
        const icon = item.locator('svg[aria-hidden="true"]');
        await expect(icon).toBeVisible();
      }
    },
  );

  test(
    '매핑 없는 알 수 없는 상태값은 원문 그대로 폴백 렌더됨',
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      // 미래에 추가될 수 있는 알 수 없는 enum 값에 대한 안전한 폴백 검증.
      const detail = createIssueDetail({
        history: [
          createHistoryEntry({
            id: 6,
            eventType: 'STATUS_CHANGED',
            fromValue: 'UNKNOWN_STATUS',
            toValue: 'ANOTHER_STATUS',
          }),
        ],
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();

      // 매핑 없는 값은 원문 그대로 표시되어야 함 (안전한 폴백).
      await expect(timeline).toContainText('UNKNOWN_STATUS → ANOTHER_STATUS');
    },
  );
});

// #341: 활동 이력 접기 — MAX=5 초과 시 "이전 N건 더 보기" 토글
test.describe('IssueActivityTimeline — 접기/펼치기 (#341)', () => {
  // 6건 이력: 기본 5건만 보이고, 더 보기 버튼으로 전체 펼침 후 접기 가능한지 검증
  test(
    '항목이 MAX(5) 이하이면 더 보기 버튼이 없고 전체 항목이 표시된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      const detail = createIssueDetail({
        history: Array.from({ length: 5 }, (_, i) =>
          createHistoryEntry({ id: i + 1, eventType: 'STATUS_CHANGED' }),
        ),
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();
      // 5건 전부 노출
      await expect(timeline.locator('li')).toHaveCount(5);
      // "더 보기" 버튼 없어야 함
      await expect(page.getByRole('button', { name: /더 보기/ })).not.toBeVisible();
    },
  );

  test(
    '항목이 MAX(5)를 초과하면 최근 5건만 표시되고 "이전 N건 더 보기" 버튼이 노출된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      // 8건 이력 — 마지막 5건만 기본 표시, 앞 3건은 숨겨짐
      const detail = createIssueDetail({
        history: Array.from({ length: 8 }, (_, i) =>
          createHistoryEntry({ id: i + 1, eventType: 'STATUS_CHANGED' }),
        ),
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();
      // 기본 5건만 표시
      await expect(timeline.locator('li')).toHaveCount(5);
      // "이전 3건 더 보기" 버튼 표시
      const moreBtn = page.getByRole('button', { name: '이전 3건 활동 더 보기' });
      await expect(moreBtn).toBeVisible();
    },
  );

  test(
    '"이전 N건 더 보기" 버튼 클릭 시 전체 항목이 표시되고 "접기" 버튼이 나타난다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      const detail = createIssueDetail({
        history: Array.from({ length: 8 }, (_, i) =>
          createHistoryEntry({ id: i + 1, eventType: 'STATUS_CHANGED' }),
        ),
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const moreBtn = page.getByRole('button', { name: '이전 3건 활동 더 보기' });
      await expect(moreBtn).toBeVisible();
      await moreBtn.click();

      // 전체 8건 표시
      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline.locator('li')).toHaveCount(8);

      // "더 보기" 버튼 사라지고 "접기" 버튼 표시
      await expect(moreBtn).not.toBeVisible();
      await expect(page.getByRole('button', { name: '활동 이력 접기' })).toBeVisible();
    },
  );

  test(
    '"접기" 버튼 클릭 시 다시 최근 5건만 표시된다',
    async ({ authenticatedPage: page }) => {
      await setupCommonStubs(page);

      const detail = createIssueDetail({
        history: Array.from({ length: 8 }, (_, i) =>
          createHistoryEntry({ id: i + 1, eventType: 'STATUS_CHANGED' }),
        ),
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(detail),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      // 더 보기 → 접기 사이클
      await page.getByRole('button', { name: '이전 3건 활동 더 보기' }).click();
      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline.locator('li')).toHaveCount(8);

      await page.getByRole('button', { name: '활동 이력 접기' }).click();
      await expect(timeline.locator('li')).toHaveCount(5);
      await expect(page.getByRole('button', { name: '이전 3건 활동 더 보기' })).toBeVisible();
    },
  );
});
