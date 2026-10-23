// IssueActivityTimeline — STATUS_CHANGED/PRIORITY_CHANGED 한국어 매핑 회귀 테스트 (#157).
// 백엔드 영문 enum 원시값이 그대로 노출되지 않고 한국어 표시명으로 렌더되는지 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import {
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
      // 활동 섹션은 '이력' 탭 안에 있으므로 먼저 탭 클릭 (Task 3 — #343)
      await page.getByRole('tab', { name: /이력/ }).click();

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
    '상태·우선순위 변경 이력이 한국어 표시명("할 일 → 진행 중", "낮음 → 높음")으로 렌더됨',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 매핑 규칙 자체(DONE·CANCELED·MID·모르는 값 폴백·null)는 issueHistoryLabels 단위 테스트가 맡는다(WP-412).
      // 여기서는 두 이벤트 분기가 실제로 매핑 함수를 거쳐 화면에 그려지는지만 본다.
      await setupCommonStubs(page);

      const detail = createIssueDetail({
        history: [
          createHistoryEntry({
            id: 1,
            eventType: 'STATUS_CHANGED',
            fromValue: 'TODO',
            toValue: 'IN_PROGRESS',
          }),
          createHistoryEntry({
            id: 4,
            eventType: 'PRIORITY_CHANGED',
            fromValue: 'LOW',
            toValue: 'HIGH',
          }),
          // WP-862: 부모 설정 — 조사·따옴표·키 표기는 issueHistoryLabels 단위 테스트가, 여기선 프로젝트 키 배선을 본다.
          createHistoryEntry({
            id: 5,
            eventType: 'PARENT_CHANGED',
            fromValue: null,
            toValue: JSON.stringify({ from: null, to: { number: 68, title: 'r76 에픽' } }),
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
      // 활동 섹션은 '이력' 탭 안에 있으므로 먼저 탭 클릭 (Task 3 — #343)
      await page.getByRole('tab', { name: /이력/ }).click();

      // 활동 타임라인 섹션 대기
      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toBeVisible();

      // 영문 enum 원시값 노출 없어야 함
      await expect(timeline).not.toContainText('TODO');
      await expect(timeline).not.toContainText('IN_PROGRESS');

      // 한국어 표시명이 렌더되어야 함
      await expect(timeline).toContainText('할 일 → 진행 중');
      await expect(timeline).toContainText('낮음 → 높음');
      await expect(timeline).toContainText(`부모를 「r76 에픽」(${PROJECT_KEY}-68)으로 설정`);
    },
  );

  test(
    '예전 이력 코드는 범주 라벨, 새 이력은 상태 이름으로 보인다 (WP-808)',
    async ({ authenticatedPage: page }) => {
      // 새 STATUS_CHANGED 이력은 상태 이름(「검토 중」)을, 예전 행은 범주 코드(TODO)를 담는다 — 둘이 섞여 와도 각자 읽힌다.
      await setupCommonStubs(page);
      const detail = createIssueDetail({
        history: [createHistoryEntry({ id: 1, eventType: 'STATUS_CHANGED', fromValue: 'TODO', toValue: '검토 중' })],
      });
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
        (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) })
            : route.fallback(),
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
      await page.getByRole('tab', { name: /이력/ }).click();
      const timeline = page.getByRole('list', { name: '활동 타임라인' });
      await expect(timeline).toContainText('할 일 → 검토 중');
      await expect(timeline).not.toContainText('TODO');
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
      // 활동 섹션은 '이력' 탭 안에 있으므로 먼저 탭 클릭 (Task 3 — #343)
      await page.getByRole('tab', { name: /이력/ }).click();

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
      // 활동 섹션은 '이력' 탭 안에 있으므로 먼저 탭 클릭 (Task 3 — #343)
      await page.getByRole('tab', { name: /이력/ }).click();

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
      // 활동 섹션은 '이력' 탭 안에 있으므로 먼저 탭 클릭 (Task 3 — #343)
      await page.getByRole('tab', { name: /이력/ }).click();

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
      // 활동 섹션은 '이력' 탭 안에 있으므로 먼저 탭 클릭 (Task 3 — #343)
      await page.getByRole('tab', { name: /이력/ }).click();

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
      // 활동 섹션은 '이력' 탭 안에 있으므로 먼저 탭 클릭 (Task 3 — #343)
      await page.getByRole('tab', { name: /이력/ }).click();

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
