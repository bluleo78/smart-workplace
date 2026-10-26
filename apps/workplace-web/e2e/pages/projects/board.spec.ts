// 태스크 보드 + 검색 + 필터 + 무한 스크롤 E2E.
// 백엔드 없이 `page.route()` 로 모킹 — 컨트랙트는 IssueResponse / IssueSearchResponse / IssueDetailResponse.
// 브라우저가 있어야 판정되는 것만 남긴다 — 드래그·호버·키보드 놓기 포커스(@input), 폭·스크롤·무한 스크롤·겹친 링크 클릭(@layout),
// 보드 대표 진입(@wiring, 종료 이슈 숨김 토글). 검색·상태 필터 쿼리·URL, 필터 칩 접근성 이름, 뷰 전환 URL, 마감 지남·AI 담당자 표시,
// 빈 열 안내·열 상태로 만들기, 제외 열 미요청, 그룹 보드 전체 로드, 종료 이슈 숨김 안내는
// 페이지 테스트 src/pages/projects/boardSearchFilter.test.tsx 가 지킨다(WP-980).

import type { Route } from '@playwright/test';

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { dropDnd, expectStays, gate, startKeyboardDrag } from '../../fixtures/wait';
import {
  createIssue,
  createIssueDetail,
  createIssueSearchResponse,
} from '../../factories/issue.factory';
import { makeEpicType, makeSubtaskType } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { statusFieldsOf } from '../../factories/projectStatus.factory';
import type { IssueResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${PROJECT_KEY}/issues`;

// 공통: 프로젝트/멤버 메타 모킹.
async function stubProjectMeta(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject());
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/members`, []);
}

// 보드 컬럼 쿼리는 프로젝트 상태 id(statusId)로 좁혀 온다(WP-808) — 시드 상태 id(1~4)를 범주로 되돌려
// 범주 기준으로 쓴 목을 그대로 쓴다. 컬럼 쿼리가 아니면(statusId 없음) null.
const SEED_CATEGORY: Record<string, string> = { '1': 'TODO', '2': 'IN_PROGRESS', '3': 'DONE', '4': 'CANCELED' };
function columnStatusOf(url: URL): string | null {
  return SEED_CATEGORY[url.searchParams.get('statusId') ?? ''] ?? null;
}

// 이슈 검색 라우트 헬퍼: pathname 매칭 + 쿼리 파라미터 파싱.
// handler 는 (route, requestUrl) 를 받아 응답을 결정한다.
function routeIssueSearch(
  page: import('@playwright/test').Page,
  handler: (route: Route, url: URL) => Promise<void> | void,
) {
  return page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return handler(route, new URL(route.request().url()));
    },
  );
}

// 카드를 컬럼 중앙으로 드래그. @dnd-kit PointerSensor distance:5 활성화 조건을
// 만족시키도록 down → move(0,0) → move(target, steps:10) 순서로 진행한다.
async function dragCardTo(
  page: import('@playwright/test').Page,
  cardTestId: string,
  columnTestId: string,
) {
  const card = page.getByTestId(cardTestId);
  const target = page.getByTestId(columnTestId);
  await card.hover();
  await page.mouse.down();
  await page.mouse.move(0, 0);
  const box = await target.boundingBox();
  if (!box) throw new Error(`${columnTestId} bounding box 없음`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await dropDnd(page);
}

test.describe('태스크 보드/검색', () => {
  test(
    '보드 진입 → DnD 로 TODO → IN_PROGRESS 카드 이동 + PATCH status 호출',
    { tag: ['@input', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      await stubProjectMeta(page);

      let issues: IssueResponse[] = [
        createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' }),
        createIssue({ id: 2, number: 2, title: 'B', status: 'IN_PROGRESS' }),
      ];

      await routeIssueSearch(page, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse(issues)),
        }),
      );

      // DnD 단축 PATCH — IssueDetailResponse 형태로 응답.
      const patches = trackRequests(page, 'PATCH', `${ISSUES_PATH}/1/status`);
      await page.route(`**${ISSUES_PATH}/1/status`, (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        // 서버처럼 본문 statusId 를 범주·이름까지 반영한다 — 안 그러면 재조회 뒤 카드가 옛 컬럼으로 돌아간다.
        const { statusId } = route.request().postDataJSON() as { statusId: number };
        issues = issues.map((i) =>
          i.number === 1 ? { ...i, ...statusFieldsOf(statusId) } : i,
        );
        const updated = issues.find((i) => i.number === 1)!;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createIssueDetail({ summary: updated, body: null, comments: [], history: [] }),
          ),
        });
      });

      await page.goto(`/projects/${PROJECT_KEY}?view=board`);

      // 4 컬럼 모두 노출
      await expect(page.getByTestId('board-col-1')).toBeVisible();
      await expect(page.getByTestId('board-col-2')).toBeVisible();
      await expect(page.getByTestId('board-col-3')).toBeVisible();
      await expect(page.getByTestId('board-col-4')).toBeVisible();

      // TODO 컬럼 안에 카드 1 이 있는 상태에서 시작
      await expect(
        page.getByTestId('board-col-1').getByTestId('issue-card-1'),
      ).toBeVisible();

      await dragCardTo(page, 'issue-card-1', 'board-col-2');

      // PATCH 호출 payload 가 진행 중 상태 id(WP-808)
      await expect.poll(() => patches.lastBody()).toEqual({ statusId: 2 });

      // optimistic update + 서버 응답으로 카드가 IN_PROGRESS 컬럼에 위치
      await expect(
        page.getByTestId('board-col-2').getByTestId('issue-card-1'),
      ).toBeVisible();
    },
  );

  test(
    '보드 진입 → DnD 로 빈 컬럼(DONE)에 카드 드롭 + PATCH status 호출 (#774 회귀)',
    { tag: ['@input', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      // 무엇을: 카드가 0개인 빈 컬럼으로 드래그 드롭 시에도 상태 변경 PATCH 가 발생하는지 검증.
      // 왜: #774 — closestCorners 단독 사용 시 populated 컬럼은 카드마다 개별 droppable 이 등록돼
      //     코너 거리 후보가 많은 반면, 빈 컬럼은 <section> 전체(세로로 긴 rect) 하나뿐이라
      //     인접 populated 컬럼의 카드 droppable 에 밀려 최근접 droppable 로 선택되지 못해 드롭이 무반응이었다.
      //     pointerWithin 우선 + closestCorners 폴백으로 교체 후 빈 컬럼 드롭이 정상 동작해야 한다.
      await stubProjectMeta(page);

      // TODO 에 카드 1개, DONE 은 카드 0개(빈 컬럼) — 드래그 대상 컬럼이 완전히 비어있는 상태로 시작.
      let issues: IssueResponse[] = [
        createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' }),
      ];

      await routeIssueSearch(page, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse(issues)),
        }),
      );

      const patches = trackRequests(page, 'PATCH', `${ISSUES_PATH}/1/status`);
      await page.route(`**${ISSUES_PATH}/1/status`, (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const { statusId } = route.request().postDataJSON() as { statusId: number };
        issues = issues.map((i) => (i.number === 1 ? { ...i, ...statusFieldsOf(statusId) } : i));
        const updated = issues.find((i) => i.number === 1)!;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createIssueDetail({ summary: updated, body: null, comments: [], history: [] }),
          ),
        });
      });

      await page.goto(`/projects/${PROJECT_KEY}?view=board`);

      // DONE 컬럼이 빈 상태(empty state)로 시작함을 먼저 확인 — 회귀의 전제조건.
      await expect(page.getByTestId('board-col-empty-3')).toBeVisible();
      await expect(
        page.getByTestId('board-col-1').getByTestId('issue-card-1'),
      ).toBeVisible();

      await dragCardTo(page, 'issue-card-1', 'board-col-3');

      // PATCH 호출 payload 가 완료 상태 id — 빈 컬럼 드롭이 실제로 인식됐다는 증거.
      await expect.poll(() => patches.lastBody()).toEqual({ statusId: 3 });

      // 카드가 DONE 컬럼으로 이동하고 empty state 는 사라진다.
      await expect(
        page.getByTestId('board-col-3').getByTestId('issue-card-1'),
      ).toBeVisible();
      await expect(page.getByTestId('board-col-empty-3')).not.toBeAttached();
    },
  );

  test('FilterChip × 버튼 터치 타겟 24px 이상 (WCAG 2.5.8 회귀)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    // × 버튼이 WCAG 2.5.8 최소 터치 타겟(24×24 CSS px) 이상인지 확인.
    await stubProjectMeta(page);
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-status').click();
    await page.getByTestId('facet-value-status-IN_PROGRESS').click();
    await expect(page.getByTestId('filter-chip-status')).toBeVisible();

    const removeBtn = page.getByTestId('filter-chip-status-remove');
    const box = await removeBtn.boundingBox();
    expect(box).not.toBeNull();
    // 터치 타겟 최소 24×24 px 보장 (WCAG 2.5.8 — #253 회귀 방지)
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
  });

  test('뷰 전환 버튼 — title 속성 없고 호버 시 shadcn Tooltip 표시 (#269 회귀)', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}`);

    const viewGroup = page.getByRole('group', { name: '뷰 전환' });
    const listBtn = viewGroup.getByRole('button', { name: '리스트' });
    const boardBtn = viewGroup.getByRole('button', { name: '보드' });

    // native title 속성 미사용 확인 — shadcn Tooltip 으로 대체됨
    expect(await listBtn.getAttribute('title')).toBeNull();
    expect(await boardBtn.getAttribute('title')).toBeNull();

    // 호버 시 shadcn TooltipContent 표시 확인 (리스트 버튼 대표 검증)
    await listBtn.hover();
    await expect(page.getByRole('tooltip', { name: '리스트' })).toBeVisible();
  });

  test('DnD PATCH 실패 → 카드 원위치 + 실패 토스트', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);

    const issues = [createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' })];
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      }),
    );
    // PATCH 가 500 으로 떨어지면 optimistic 롤백 + 토스트.
    await page.route(`**${ISSUES_PATH}/1/status`, (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      // message/errors 가 비어 있어 handleApiError 가 fallback 메시지를 사용하도록 한다.
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 500,
          error: 'Internal Server Error',
          message: '',
          errors: null,
          timestamp: new Date().toISOString(),
          path: `${ISSUES_PATH}/1/status`,
        }),
      });
    });

    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await expect(
      page.getByTestId('board-col-1').getByTestId('issue-card-1'),
    ).toBeVisible();

    await dragCardTo(page, 'issue-card-1', 'board-col-3');

    // 실패 토스트 + 카드가 TODO 컬럼으로 롤백
    await expect(page.getByText(/태스크 상태 변경에 실패/)).toBeVisible();
    await expect(
      page.getByTestId('board-col-1').getByTestId('issue-card-1'),
    ).toBeVisible();
    await expect(
      page.getByTestId('board-col-3').getByTestId('issue-card-1'),
    ).toHaveCount(0);
  });

  test('보드 카드: 에픽 하위 이슈는 소속 에픽 배지를 표시하고, 긴 제목도 카드 폭을 넘지 않는다 (#874)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    // 실데이터 폭 검증: 이슈·에픽 제목 모두 긴 케이스.
    const child = createIssue({
      id: 1,
      number: 8,
      title: '로그인 폼 컴포넌트 리팩터링 및 접근성 개선 — 키보드 포커스 트랩 대응',
      parent: { number: 3, title: '인증/온보딩 사용자 경험 전면 개선 에픽 — 2026 하반기 로드맵', type: makeEpicType() },
    });
    // 대조군: 부모 없는 이슈 / SUBTASK(헤더 └ KEY-N 표시, 에픽 배지 없음).
    const plain = createIssue({ id: 2, number: 9, title: '문구 수정' });
    const subtask = createIssue({
      id: 3,
      number: 10,
      title: '버튼 라벨',
      type: makeSubtaskType(),
      parent: { number: 9, title: '문구 수정', type: plain.type! },
    });
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([child, plain, subtask])),
      }),
    );

    await page.goto(`/projects/WP?view=board`);
    const card = page.getByTestId('issue-card-8');
    const badge = card.getByTestId('issue-card-8-epic');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('인증/온보딩');
    await expect(badge).toHaveAttribute('title', /WP-3 · 인증\/온보딩/);
    // 배지가 카드 경계 안에 머문다(말줄임).
    const cardBox = (await card.boundingBox())!;
    const badgeBox = (await badge.boundingBox())!;
    expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    await expect(page.getByTestId('issue-card-9-epic')).toHaveCount(0);
    await expect(page.getByTestId('issue-card-10-epic')).toHaveCount(0);
    await expect(page.getByTestId('issue-card-10-parent')).toBeVisible();

    await page.screenshot({ path: 'test-results/tc/board/epic-badge-card.png', fullPage: false });

    // 배지는 정적 — 카드 클릭(배지 영역 포함)은 이슈 상세로 이동한다.
    await badge.click();
    await expect(page).toHaveURL(/\/projects\/WP\/issues\/8$/);
  });

  test('카드: 우선순위 막대 렌더 + 카드 전체(담당자 영역) 클릭으로 상세 이동 (#234)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    const issue = createIssue({ id: 1, number: 7, title: '로그인 버그', status: 'IN_PROGRESS', priority: 'HIGH' });
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([issue])),
      }),
    );

    await page.goto(`/projects/WP?view=board`);
    const card = page.getByTestId('issue-card-7');
    await expect(card).toBeVisible();
    // 우선순위 막대 렌더 확인
    await expect(card.getByLabel('우선순위 높음')).toBeVisible();
    // 카드 전체(담당자 영역) 클릭 → 상세 이동
    await card.getByTestId('issue-card-7-assignees').click();
    await expect(page).toHaveURL(/\/projects\/WP\/issues\/7$/);
  });

  test('카드: 5px 이상 드래그는 상세를 열지 않는다(클릭/드래그 구분) (#234)', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    const issue = createIssue({ id: 1, number: 7, title: '로그인 버그', status: 'TODO', priority: 'MID' });
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([issue])),
      }),
    );

    await page.goto(`/projects/WP?view=board`);
    const card = page.getByTestId('issue-card-7');
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 8 });
    await dropDnd(page);
    await expect(page).toHaveURL(/\/projects\/WP\?view=board$/);
  });

  test('보드: 1024px 좁은 폭에서 컬럼 min-width 240px 보존 (제목 절단 방지) (#132)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    // 무엇을: 1024px(lg 브레이크포인트) 진입 시 보드 컬럼 폭을 검증.
    // 왜: 기존 4-track grid 는 1024px 에서 컬럼이 ~160px 로 압축돼 truncate 제목이 1~2자로 절단 → 식별 불가.
    //     Option A(컬럼 min-w-[240px] + 가로 스크롤)로 컬럼이 최소 240px 를 유지하는지 직접 측정한다.
    await page.setViewportSize({ width: 1024, height: 768 });
    await stubProjectMeta(page);

    const issues = [
      createIssue({ id: 1, number: 1, title: '로그인 페이지에서 새로고침 시 세션이 풀리는 버그', status: 'TODO' }),
      createIssue({ id: 2, number: 2, title: '대시보드 위젯 로딩 스피너가 사라지지 않음', status: 'IN_PROGRESS' }),
      createIssue({ id: 3, number: 3, title: '알림 배지 카운트가 실시간으로 갱신되지 않는 문제', status: 'DONE' }),
    ];
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    // 컬럼이 노출되고, 폭이 최소 240px 이상이어야 한다(min-w floor).
    await expect(page.getByTestId('board-col-1')).toBeVisible();
    // 레이아웃이 자리 잡기 전 측정값에 걸리지 않도록 폭을 재시도하며 단언(WP-225).
    await expect
      .poll(() => page.getByTestId('board-col-1').evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThanOrEqual(240);
  });

  test('보드 카드(데스크톱): 좁은 컬럼에서도 키는 한 줄, 제목은 카드 폭 전체로 두 줄까지 (WP-460)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    // 왜: 키·제목이 한 줄을 나눠 쓰던 때는 1024 폭(컬럼 ~240px)에서 키가 「WP-/1047」 로 꺾이고 제목은 앞 몇 글자만 남았다.
    //     시안 C — 제목은 자기 줄에서 카드 폭 전체로 최대 2줄, 키는 아래 메타 줄(nowrap).
    await page.setViewportSize({ width: 1024, height: 768 });
    await stubProjectMeta(page);
    const issue = createIssue({
      id: 1,
      number: 1047,
      title: '로그인 페이지에서 새로고침하면 세션이 풀리고 다시 로그인해야 하는 문제 — 리프레시 토큰 재발급 경합',
      status: 'TODO',
    });
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([issue])),
      }),
    );
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    const card = page.getByTestId('issue-card-1047');
    const key = card.getByTestId('issue-card-1047-key');
    const title = card.getByTestId('issue-card-1047-title');
    await expect(key).toHaveText(`${PROJECT_KEY}-1047`);
    const metrics = () =>
      Promise.all([card, key, title].map((l) => l.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, lh: parseFloat(getComputedStyle(el).lineHeight) };
      })));
    // 레이아웃이 자리 잡은 뒤 값으로 판정한다(WP-225).
    await expect.poll(async () => {
      const [c, k, t] = await metrics();
      return {
        keyOneLine: k.h < k.lh * 1.5,
        titleTwoLines: t.h > t.lh * 1.5 && t.h < t.lh * 2.5,
        titleWide: t.w > c.w * 0.6,
      };
    }).toEqual({ keyOneLine: true, titleTwoLines: true, titleWide: true });
  });

  test('보드: 컬럼 헤더가 카드 제목보다 강한 시각 계층 — text-sm + text-foreground 회귀 (#286)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    // 무엇을: 컬럼 헤더 className 에 text-sm, text-foreground 가 포함되고
    //         카드 식별자(이슈 번호)에 text-xs, text-muted-foreground 가 포함되는지 검증.
    // 왜: 헤더가 text-xs + text-muted-foreground 로 렌더되면 카드 본문보다 눈에 덜 띄어
    //     시각 위계가 역전되는 회귀(#286)가 발생한다.
    await stubProjectMeta(page);
    const issues = [
      createIssue({ id: 1, number: 1, title: '회귀 검증용 이슈', status: 'TODO' }),
    ];
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await expect(page.getByTestId('board-col-1')).toBeVisible();

    // 컬럼 헤더: text-sm + text-foreground (강화된 계층)
    const headerClass = await page
      .getByTestId('board-col-1')
      .locator('header')
      .getAttribute('class');
    expect(headerClass).toContain('text-sm');
    expect(headerClass).toContain('text-foreground');
    expect(headerClass).not.toContain('text-xs');
    expect(headerClass).not.toContain('text-muted-foreground');

    // 카드 이슈 번호: 메타 줄(text-xs + text-muted-foreground)의 약화된 보조 텍스트 — WP-460 부터 키는 메타 줄에 있어 스타일을 상속한다.
    const card = page.getByTestId('issue-card-1');
    await expect(card).toBeVisible();
    const key = card.getByTestId('issue-card-1-key');
    const title = card.getByTestId('issue-card-1-title');
    const style = (el: Element) => ({ size: parseFloat(getComputedStyle(el).fontSize), color: getComputedStyle(el).color });
    const [keyStyle, titleStyle] = await Promise.all([key.evaluate(style), title.evaluate(style)]);
    expect(keyStyle.size).toBeLessThan(titleStyle.size);
    expect(keyStyle.color).not.toBe(titleStyle.color);
  });

  test('보드 카드 — hover 시 GripVertical 드래그 핸들 표시 (#288 회귀)', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    // 무엇을: 카드에 드래그 핸들(GripVertical 아이콘)이 렌더되고, hover 시 opacity 가 0 초과인지 검증.
    // 왜: #288 — 핸들 없이 cursor-grab 만으로는 드래그 어포던스 미노출. hover 로 opacity 전환을 확인.
    await stubProjectMeta(page);
    const issues = [
      createIssue({ id: 1, number: 3, title: '드래그 핸들 테스트', status: 'TODO' }),
    ];
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    const card = page.getByTestId('issue-card-3');
    await expect(card).toBeVisible();

    // 핸들 DOM 존재 확인
    const grip = card.getByTestId('issue-card-grip');
    await expect(grip).toBeAttached();

    // hover 전: opacity-0(투명)
    const opacityBefore = await grip.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacityBefore)).toBe(0);

    // hover 후: opacity > 0 (transition-opacity 완료까지 poll)
    await card.hover();
    await expect.poll(
      async () => Number(await grip.evaluate((el) => getComputedStyle(el).opacity)),
      { timeout: 2000 },
    ).toBeGreaterThan(0);
  });

  test('보드 카드 — hover 시 배경색 변화로 클릭 어포던스 노출 (#304 회귀)', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    // 무엇을: 카드 컨테이너 className 에 transition-colors + hover:bg-accent/30 이 적용되고,
    //         실제 hover 시 배경색(computed background-color)이 변하는지 검증한다.
    // 왜: #304 — 카드가 bg-card 로 고정되어 hover 반응이 없어 클릭 가능 요소임을 직관적으로 알 수 없었음.
    await stubProjectMeta(page);
    const issues = [
      createIssue({ id: 1, number: 3, title: 'hover 배경 테스트', status: 'TODO' }),
    ];
    await routeIssueSearch(page, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      }),
    );

    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    const card = page.getByTestId('issue-card-3');
    await expect(card).toBeVisible();

    // className 에 transition-colors + hover:bg-accent/30 토큰이 포함되어야 한다(토큰 회귀 방지).
    const cls = await card.getAttribute('class');
    expect(cls).toContain('transition-colors');
    expect(cls).toContain('hover:bg-accent/30');

    // hover 전후 computed background-color 가 실제로 달라지는지 확인(파이프라인 검증).
    const bgBefore = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    await card.hover();
    await expect
      .poll(async () => card.evaluate((el) => getComputedStyle(el).backgroundColor), {
        timeout: 2000,
      })
      .not.toBe(bgBefore);
  });

  test('리스트 무한 스크롤 — 두번째 페이지가 cursor 로 자동 로드', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);

    const firstPage = [
      createIssue({ id: 1, number: 1, title: 'First' }),
      createIssue({ id: 2, number: 2, title: 'Second' }),
    ];
    const secondPage = [createIssue({ id: 3, number: 3, title: 'Third' })];

    const searches = trackRequests(page, 'GET', ISSUES_PATH);
    await routeIssueSearch(page, (route, url) => {
      const cursor = url.searchParams.get('cursor');
      const body = cursor
        ? JSON.stringify(createIssueSearchResponse(secondPage, null))
        : JSON.stringify(createIssueSearchResponse(firstPage, 'CURSOR1'));
      return route.fulfill({ status: 200, contentType: 'application/json', body });
    });

    await page.goto(`/projects/${PROJECT_KEY}`);
    await expect(page.getByTestId('issue-row-1')).toBeVisible();
    await expect(page.getByTestId('issue-row-2')).toBeVisible();

    // sentinel(아래쪽 div) 이 진입하도록 스크롤
    await page.mouse.wheel(0, 5000);

    await expect
      .poll(() => searches.urls().some((u) => u.searchParams.get('cursor')), { timeout: 5_000 })
      .toBe(true);
    await expect(page.getByTestId('issue-row-3')).toBeVisible();
    expect(searches.count()).toBeGreaterThanOrEqual(2);
  });

  // #875 — 보드는 컬럼마다 상태(statusId, WP-808)로 좁힌 독립 쿼리를 쓰고, 컬럼 끝까지 스크롤하면 그 컬럼의 다음 페이지를 받는다.
  // 왜: 단일 쿼리 100건×2페이지 상한이라 200건을 넘는 프로젝트에서 카드가 안내 없이 누락됐다.
  test('보드 컬럼별 무한 스크롤 — TODO 컬럼 끝에서 다음 페이지를 cursor+status=TODO 로 로드 (#875)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);

    // TODO 60건(50 + 10), IN_PROGRESS 1건, 나머지 0건.
    const todos = Array.from({ length: 60 }, (_, i) =>
      createIssue({ id: 100 + i, number: 100 + i, title: `할 일 ${i + 1}`, status: 'TODO' }),
    );
    const inProgress = [createIssue({ id: 1, number: 1, title: '진행 이슈', status: 'IN_PROGRESS' })];

    const searches = trackRequests(page, 'GET', ISSUES_PATH);
    const seen = () =>
      searches.urls().map((u) => ({
        status: columnStatusOf(u),
        cursor: u.searchParams.get('cursor'),
        size: u.searchParams.get('size'),
      }));
    await routeIssueSearch(page, (route, url) => {
      const status = columnStatusOf(url);
      const cursor = url.searchParams.get('cursor');
      let body;
      if (status === 'TODO') {
        body = cursor
          ? createIssueSearchResponse(todos.slice(50), null)
          : createIssueSearchResponse(todos.slice(0, 50), 'TODO_CURSOR');
      } else if (status === 'IN_PROGRESS') {
        body = createIssueSearchResponse(inProgress);
      } else {
        body = createIssueSearchResponse([]);
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    // 첫 페이지 — 컬럼마다 status 단일값 + size=50 으로 요청.
    await expect(page.getByTestId('board-col-1').getByTestId('issue-card-100')).toBeVisible();
    await expect(page.getByTestId('board-col-2').getByTestId('issue-card-1')).toBeVisible();
    for (const s of ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']) {
      expect(seen().some((q) => q.status === s && q.size === '50' && q.cursor == null)).toBe(true);
    }
    // 다른 상태 카드가 섞이지 않고, 남은 페이지가 있는 컬럼은 "50+" 로 표시.
    await expect(page.getByTestId('board-col-count-1')).toHaveText('50+');
    await expect(page.getByTestId('board-col-count-2')).toHaveText('1');

    // TODO 컬럼 끝까지 스크롤 → 두번째 페이지 요청(cursor + status=TODO).
    await page.getByTestId('board-col-more-1').scrollIntoViewIfNeeded();
    await expect
      .poll(() => seen().some((q) => q.status === 'TODO' && q.cursor === 'TODO_CURSOR'))
      .toBe(true);
    await expect(page.getByTestId('board-col-1').getByTestId('issue-card-159')).toBeVisible();
    await expect(page.getByTestId('board-col-count-1')).toHaveText('60');
    await expect(page.getByTestId('board-col-more-1')).not.toBeAttached();
    // 다른 컬럼은 cursor 요청이 나가지 않는다.
    expect(seen().some((q) => q.status !== 'TODO' && q.cursor != null)).toBe(false);
  });

  test('보드 컬럼 다음 페이지 실패 — 무한 재요청 없이 다시 시도 버튼 노출 (#875)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    // 왜: sentinel 이 계속 보이는 상태에서 실패 후 isFetching 해제마다 observer 가 재발화해 실패 요청을 무한 반복했다.
    await stubProjectMeta(page);
    // 라우트가 500 으로 응답하는 TODO 컬럼 다음 페이지(cursor) 요청만 센다.
    const failing = trackRequests(
      page,
      'GET',
      (u) => u.pathname === ISSUES_PATH && columnStatusOf(u) === 'TODO' && !!u.searchParams.get('cursor'),
    );
    await routeIssueSearch(page, (route, url) => {
      const status = columnStatusOf(url);
      if (status === 'TODO' && url.searchParams.get('cursor')) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      }
      const items = status === 'TODO' ? [createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' })] : [];
      const body = createIssueSearchResponse(items, status === 'TODO' ? 'NEXT' : null);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    // react-query 재시도 백오프(~1초)를 가상 시계로 넘긴다
    await page.clock.install();
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    await failing.waitFor();
    await page.clock.fastForward(1500);
    const retry = page.getByTestId('board-col-more-1').getByRole('button', { name: /다시 시도/ });
    await expect(retry).toBeVisible();
    // 실패 확정 후 추가 요청이 더 나가지 않는다(react-query 기본 재시도 포함 횟수에서 멈춤).
    const settled = failing.count();
    await page.clock.fastForward(1500);
    await expectStays(page, failing.count, settled, { ms: 200 });
    // 다시 시도 → 요청 1회 더.
    await retry.click();
    await failing.waitFor(settled + 1);
  });

});

// #876 — 활성 사이클 밖 종료(완료·취소) 이슈 숨김 + 「완료 모두 보기」 토글.
test.describe('종료 이슈 숨김 (#876)', () => {
  test('보드 기본 검색은 hideInactiveClosed 를 보내고, 토글을 켜면 URL closed=all 로 숨김을 해제한다', { tag: '@wiring' }, async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    const searches = trackRequests(page, 'GET', ISSUES_PATH);
    await routeIssueSearch(page, (route, url) => {
      // 토글 전: 서버가 숨긴 결과(진행 중만) / 토글 후: 완료 이슈 포함.
      const showAll = url.searchParams.get('hideInactiveClosed') == null;
      const items = [createIssue({ id: 1, number: 7, title: '진행 중 작업', status: 'IN_PROGRESS' })];
      if (showAll) items.push(createIssue({ id: 2, number: 8, title: '지난달 끝난 작업', status: 'DONE' }));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(items)),
      });
    });

    await page.goto(`/projects/WP?view=board`);
    await expect(page.getByTestId('issue-card-7')).toBeVisible();
    await expect(page.getByTestId('issue-card-8')).toHaveCount(0);
    expect(searches.lastUrl()!.searchParams.get('hideInactiveClosed')).toBe('true');

    const toggle = page.getByTestId('show-all-closed-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/closed=all/);
    await expect(page.getByTestId('issue-card-8')).toBeVisible();
    expect(searches.lastUrl()!.searchParams.get('hideInactiveClosed')).toBeNull();
  });

  test('완료로 끌어 놓은 이슈가 숨겨지면 토스트로 이유와 「모두 보기」를 알리고, 활성 사이클 이슈는 그대로 둔다', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    await stubProjectMeta(page);
    const issues = [
      createIssue({ id: 1, number: 7, title: '사이클 없는 작업', status: 'IN_PROGRESS' }),
      createIssue({ id: 2, number: 9, title: '이번 사이클 작업', status: 'IN_PROGRESS' }),
    ];
    await routeIssueSearch(page, (route, url) => {
      const status = columnStatusOf(url);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues.filter((i) => !status || i.status === status))),
      });
    });
    await page.route('**/issues/*/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueDetail()) }),
    );
    // 7번은 사이클 없음(숨겨짐), 9번은 진행 중 사이클 소속(남음).
    const cycleLookups = trackRequests(page, 'GET', /\/issues\/\d+\/cycles$/);
    await page.route(/\/api\/v1\/projects\/WP\/issues\/\d+\/cycles$/, (route) => {
      const n = Number(new URL(route.request().url()).pathname.split('/').at(-2));
      const cycles = n === 9 ? [{ id: 1, name: '10월 3주', status: 'ACTIVE' }] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cycles) });
    });

    await page.goto(`/projects/WP?view=board`);
    await dragCardTo(page, 'issue-card-9', 'board-col-3');
    await expect(page.getByText('상태를 변경했습니다', { exact: true })).toBeVisible();
    await expect.poll(cycleLookups.count).toBe(1);

    await dragCardTo(page, 'issue-card-7', 'board-col-3');
    const toast = page.locator('[data-sonner-toast]', { hasText: '활성 사이클 밖에서 끝난 이슈는 이 화면에서 숨겨집니다' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: '모두 보기' }).click();
    await expect(page).toHaveURL(/closed=all/);
    await expect(page.getByTestId('show-all-closed-toggle')).toHaveAttribute('aria-pressed', 'true');
  });
});

// 회귀 가드: 그룹 보드는 읽기전용이라 다른 그룹 카드 위에 놓아도 그 카드의 status 로 바뀌면 안 된다.
// (공용 DndContext 이관 후에도 그룹 보드에 상태 드롭 모니터가 붙지 않는지 확인)
test('담당자 그룹 보드에서 카드를 다른 그룹 카드 위에 놓아도 상태가 바뀌지 않는다', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  await stubProjectMeta(page);
  const alice = { id: 1, username: 'alice', name: 'Alice', kind: 'HUMAN' as const };
  const bob = { id: 2, username: 'bob', name: 'Bob', kind: 'HUMAN' as const };
  const a = createIssue({ id: 1, number: 1, title: 'A', status: 'TODO', assignees: [alice] });
  const b = createIssue({ id: 2, number: 2, title: 'B', status: 'DONE', assignees: [bob] });
  await routeIssueSearch(page, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createIssueSearchResponse([a, b])),
    }),
  );
  const statusPatches = trackRequests(page, 'ANY', /\/issues\/[^/]+\/status$/);
  await page.route('**/issues/*/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createIssueDetail()),
    }),
  );
  await page.goto(`/projects/${PROJECT_KEY}?view=board&group=assignee`);
  // dragCardTo 를 풀어 쓴다 — 놓기 전에 드래그가 실제로 시작됐는지(원본 흐림·고스트) 확인해 헛통과를 막는다.
  const card = page.getByTestId('issue-card-1');
  await card.hover();
  await page.mouse.down();
  await page.mouse.move(0, 0);
  const box = (await page.getByTestId('issue-card-2').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await expect(card).toHaveCSS('opacity', '0.4');
  await expect(page.getByTestId('issue-card-drag-overlay')).toBeVisible();
  await dropDnd(page);
  await expectStays(page, statusPatches.count, 0);
});

// 키보드로 다른 열에 놓은 카드의 포커스(WP-837) — 상태가 바뀐 카드는 새 열에 새로 그려져 원래 요소가 지워지므로,
// 포커스가 body 로 빠지지 않고 옮긴 카드(숨겨지면 놓은 열, 실패로 되돌아가면 원래 열의 그 카드)에 남아야 한다.
test.describe('보드 키보드 놓기 뒤 포커스 (WP-837)', { tag: '@input' }, () => {
  // 상태별 검색 — PATCH 가 바꾼 상태를 다음 조회에 반영한다. 숨김(hideInactiveClosed)이면 완료 이슈를 빼서 「숨겨짐」을 흉내 낸다.
  // 열 쿼리는 시드 상태 id(statusId)로 좁혀 온다(WP-808) — 범주로 되돌려 범주 기준 목을 쓴다. 열은 할 일 1·진행 중 2·완료 3.
  async function setupKeyboardBoard(page: import('@playwright/test').Page, opts: { fail?: boolean; hideDone?: boolean } = {}) {
    await stubProjectMeta(page);
    let issues: IssueResponse[] = [
      createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' }),
      createIssue({ id: 2, number: 2, title: 'B', status: 'IN_PROGRESS' }),
    ];
    await routeIssueSearch(page, (route, url) => {
      const status = columnStatusOf(url);
      const hidden = opts.hideDone && url.searchParams.get('hideInactiveClosed') != null;
      const items = issues.filter((i) => (!status || i.status === status) && !(hidden && i.status === 'DONE'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(items)) });
    });
    await page.route(/\/api\/v1\/projects\/WP\/issues\/\d+\/cycles$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    const patches = trackRequests(page, 'PATCH', /\/issues\/\d+\/status$/);
    await page.route(/\/issues\/\d+\/status$/, async (route) => {
      if (opts.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"상태를 바꾸지 못했습니다(테스트)"}' });
      const n = Number(new URL(route.request().url()).pathname.split('/').at(-2));
      // 서버처럼 본문 statusId 를 범주·이름까지 반영한다.
      const { statusId } = route.request().postDataJSON() as { statusId: number };
      issues = issues.map((i) => (i.number === n ? { ...i, ...statusFieldsOf(statusId) } : i));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueDetail({ summary: issues.find((i) => i.number === n)!, body: null, comments: [], history: [] })),
      });
    });
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);
    return patches;
  }

  // 카드를 Space(집기) → →(오른쪽 열) → Space(놓기). 집은 뒤 센서가 방향키 리스너를 붙일 때까지 기다리고(startKeyboardDrag —
  // 부하에서 바로 누른 방향키는 버려진다), 이동·놓기는 스크린리더 안내(dnd-kit 라이브 영역)로 기다린다.
  async function keyboardMoveRight(card: import('@playwright/test').Locator, toLabel: string) {
    const live = card.page().locator('[id^="DndLiveRegion"]');
    await startKeyboardDrag(card, () => expect(live).toContainText('이슈'));
    await card.page().keyboard.press('ArrowRight');
    await expect(live).toContainText(toLabel);
    await card.page().keyboard.press('Space');
    await expect(live).toContainText('놓았습니다');
  }

  test('다른 열에 놓으면 새 열의 그 카드에 포커스가 남아 이어서 다시 옮길 수 있다', async ({ authenticatedPage: page }) => {
    const patches = await setupKeyboardBoard(page);
    await keyboardMoveRight(page.getByTestId('issue-card-1'), '진행 중');
    await expect.poll(() => patches.lastBody()).toEqual({ statusId: 2 });
    const moved = page.getByTestId('board-col-2').getByTestId('issue-card-1');
    await expect(moved).toBeFocused();
    // 서버 응답 뒤 다시 조회해도 포커스가 유지된다.
    await expect(page.getByText('상태를 변경했습니다', { exact: true })).toBeVisible();
    await expect(moved).toBeFocused();
    // 이어서 같은 카드를 한 번 더 옮길 수 있다.
    await keyboardMoveRight(moved, '완료');
    await expect.poll(() => patches.lastBody()).toEqual({ statusId: 3 });
    await expect(page.getByTestId('board-col-3').getByTestId('issue-card-1')).toBeFocused();
  });

  test('놓은 이슈가 종료 숨김으로 사라지면 놓은 열에 포커스가 간다', async ({ authenticatedPage: page }) => {
    const patches = await setupKeyboardBoard(page, { hideDone: true });
    await keyboardMoveRight(page.getByTestId('issue-card-2'), '완료');
    await expect.poll(() => patches.lastBody()).toEqual({ statusId: 3 });
    await expect(page.getByTestId('board-col-empty-3')).toBeVisible();
    await expect(page.getByTestId('board-col-3')).toBeFocused();
  });

  test('상태 변경이 실패해 원래 열로 되돌아가도 그 카드에 포커스가 남는다', async ({ authenticatedPage: page }) => {
    const patches = await setupKeyboardBoard(page, { fail: true });
    await keyboardMoveRight(page.getByTestId('issue-card-1'), '진행 중');
    await expect.poll(patches.count).toBe(1);
    await expect(page.getByText('상태를 바꾸지 못했습니다(테스트)')).toBeVisible();
    await expect(page.getByTestId('board-col-1').getByTestId('issue-card-1')).toBeFocused();
  });

  // 열마다 따로 재조회한다 — 원래 열 응답(카드 없음)이 새 열 응답보다 먼저 와도 카드가 어느 열에서도 사라지지 않아야 한다(WP-860).
  test('놓은 뒤 원래 열 재조회가 새 열보다 먼저 끝나도 카드가 새 열에 계속 보인다', async ({ authenticatedPage: page }) => {
    await stubProjectMeta(page);
    let issues: IssueResponse[] = [createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' })];
    let patched = false;
    let todoAfterPatch = 0;
    const holdInProgress = gate();
    await routeIssueSearch(page, async (route, url) => {
      const status = columnStatusOf(url);
      // 놓은 뒤의 새 열(진행 중) 재조회만 붙잡아, 원래 열(할 일) 응답이 먼저 도착하게 한다.
      if (patched && status === 'IN_PROGRESS') await holdInProgress.p;
      const items = issues.filter((i) => !status || i.status === status);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(items)) });
      if (patched && status === 'TODO') todoAfterPatch++;
    });
    await page.route(/\/api\/v1\/projects\/WP\/issues\/\d+\/cycles$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(/\/issues\/\d+\/status$/, (route) => {
      issues = issues.map((i) => ({ ...i, ...statusFieldsOf(2) }));
      patched = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueDetail({ summary: issues[0], body: null, comments: [], history: [] })),
      });
    });
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    await keyboardMoveRight(page.getByTestId('issue-card-1'), '진행 중');
    // 원래 열 재조회(카드 없음)가 끝난 뒤에도, 새 열 응답을 기다리는 동안 카드는 새 열에 그대로 있다.
    await expect.poll(() => todoAfterPatch).toBeGreaterThan(0);
    const moved = page.getByTestId('board-col-2').getByTestId('issue-card-1');
    await expectStays(page, () => moved.count(), 1);
    holdInProgress.release();
    await expect(page.getByText('상태를 변경했습니다', { exact: true })).toBeVisible();
    await expect(page.getByTestId('issue-card-1')).toHaveCount(1);
    await expect(moved).toBeVisible();
  });
});
