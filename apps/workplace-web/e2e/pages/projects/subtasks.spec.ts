// Phase 4a SUBTASK 도메인 E2E.
// 시나리오 1 (smoke): 비SUBTASK(TASK) 상세 진입 → 자식 SUBTASK 인라인 추가
//   → POST /issues payload {title, typeId:5, parentNumber:1} 검증 → 자식 리스트 갱신.
// 시나리오 2: SUBTASK 상세 진입 → 부모 슬롯 노출 → number 입력 → PATCH /issues/{n}/parent
//   payload {parentNumber:15} 검증 → 슬롯의 ParentBadge 갱신.
// 시나리오 3 (회귀): 하위 태스크 목록이 createdAt 오름차순으로 표시됨 (refs #166).
//   백엔드는 updatedAt desc 로 정렬 반환 → 프론트에서 createdAt asc 재정렬 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { agentWorker, createAgentWork } from '../../factories/agentWork.factory';
import {
  createIssue,
  createIssueDetail,
  createIssueSearchResponse,
} from '../../factories/issue.factory';
import { makeSubtaskType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import type { IssueDetailResponse } from '../../../src/types/issue';

const KEY = 'WP';
const ISSUES_BASE = `/api/v1/projects/${KEY}/issues`;

// 공통 stub — 프로젝트/멤버/유형/라벨. 이슈 상세 페이지가 fetch 하는 보조 엔드포인트들.
async function setupCommonStubs(page: Parameters<Parameters<typeof test>[2]>[0]['page']) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        key: KEY,
        name: 'P',
        description: '',
        ownerId: 1,
        ownerName: 'T',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    }),
  );
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { userId: 1, username: 'me', name: 'Me', role: 'OWNER' },
      ]),
    }),
  );
  await page.route(`**/api/v1/projects/${KEY}/types`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(systemTypes()),
    }),
  );
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

type StubParent = { number: number; title: string; type: ReturnType<typeof makeTaskType> };

// SUBTASK(#5) 상세 응답 본문 — 부모만 바꿔 가며 여러 테스트가 같이 쓴다(멤버 시나리오 — 편집 권한 있음, WP-481).
function subtaskDetailBody(parent: StubParent, overrides: Partial<IssueDetailResponse> = {}) {
  return createIssueDetail({
    ...overrides,
    body: '',
    summary: createIssue({ id: 5, number: 5, title: '자식 SUBTASK', type: makeSubtaskType(), parent }),
  });
}

// SUBTASK(#5) 상세 + watchers/attachments stub. 부모는 호출 시점의 getParent() 로 동적.
async function stubSubtaskDetail(
  page: Parameters<Parameters<typeof test>[2]>[0]['page'],
  getParent: () => StubParent,
  overrides: Partial<IssueDetailResponse> = {},
) {
  await page.route(
    (url) => url.pathname === `${ISSUES_BASE}/5`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(subtaskDetailBody(getParent(), overrides)),
      }),
  );
  await page.route(
    (url) =>
      url.pathname === `${ISSUES_BASE}/5/watchers` ||
      url.pathname === `${ISSUES_BASE}/5/attachments`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

test.describe('SUBTASK', () => {
  test(
    '비SUBTASK 진입 → 자식 SUBTASK 추가 → POST payload + 리스트 갱신',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const taskSummary = {
        id: 1,
        name: 'TASK',
        colorToken: 'BLUE' as const,
        icon: 'Circle' as const,
      };
      const parentIssue = {
        ...createIssue({ id: 1, number: 1, title: '부모 TASK' }),
        type: taskSummary,
      };
      // 자식은 mutation 후 in-memory 누적.
      let childCreated: Array<{ id: number; number: number; title: string }> = [];
      const creates = trackRequests(page, 'POST', ISSUES_BASE);

      await setupCommonStubs(page);

      // 이슈 상세 — 호출될 때마다 최신 childCount 반영.
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              summary: {
                ...parentIssue,
                childCount: childCreated.length,
                childDoneCount: 0,
                parent: null,
                labels: [],
                attachmentCount: 0,
                assignees: [],
              },
              body: '',
              comments: [],
              history: [],
              attachments: [],
            }),
          }),
      );
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1/watchers`,
        (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1/attachments`,
        (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );

      // /issues 컬렉션 — GET (검색, parent 필터) + POST (자식 생성).
      // pathname 이 정확히 `/issues` 인 요청만 처리. detail 등은 위 route 가 먼저 잡는다.
      await page.route(
        (url) => url.pathname === ISSUES_BASE,
        (route) => {
          const req = route.request();
          if (req.method() === 'POST') {
            const { title } = req.postDataJSON() as { title: string };
            const next = childCreated.length + 100;
            const child = {
              id: next,
              number: next,
              title,
            };
            childCreated = [...childCreated, child];
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                ...createIssue({ id: child.id, number: child.number, title: child.title }),
                type: makeSubtaskType(),
                parent: { number: 1, title: '부모 TASK', type: taskSummary },
              }),
            });
          }
          // GET search — parent=1 이면 자식 리스트, 그 외는 빈 결과.
          const url = new URL(req.url());
          const parentParam = url.searchParams.get('parent');
          if (parentParam === '1') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(
                createIssueSearchResponse(
                  childCreated.map((c) => ({
                    ...createIssue({ id: c.id, number: c.number, title: c.title }),
                    type: makeSubtaskType(),
                    parent: { number: 1, title: '부모 TASK', type: taskSummary },
                  })),
                  null,
                ),
              ),
            });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse([], null)),
          });
        },
      );

      await page.goto(`/projects/${KEY}/issues/1`);

      // 비SUBTASK(TASK) 진입 — 자식 섹션 노출 + 부모 슬롯도 "상위 에픽" 문구로 노출(EPIC 계층 확장, Task 6).
      await expect(page.getByTestId('issue-children-section')).toBeVisible();
      await expect(page.getByTestId('issue-parent-slot')).toHaveCount(1);
      await expect(page.getByTestId('issue-parent-slot')).toContainText('상위 에픽');
      // 섹션 제목이 한국어로 표시되는지 확인 (#133 회귀 방지).
      await expect(page.getByRole('heading', { name: '하위 태스크', level: 3 })).toBeVisible();
      // 초기 빈 상태 — 불필요한 "없습니다" 안내 문구 없이 추가 입력만 노출.
      await expect(page.getByText('하위 태스크가 없습니다')).toHaveCount(0);
      await expect(page.getByTestId('child-add-input')).toBeVisible();

      // SUBTASK 인라인 추가.
      await page.getByTestId('child-add-input').fill('첫 자식');
      await page
        .getByTestId('child-add-form')
        .getByRole('button', { name: '추가' })
        .click();

      // POST payload — 백엔드 컨트랙트 검증.
      await expect
        .poll(() => creates.lastBody())
        .toEqual({ title: '첫 자식', typeId: 5, parentNumber: 1 });

      // 추가 후 자식 리스트 갱신 (invalidate → refetch).
      await expect(page.getByTestId('child-row-100')).toBeVisible();
      await expect(page.getByTestId('child-row-100')).toContainText('첫 자식');
      // 상태 배지는 raw Badge variant 대신 시맨틱 StatusBadge(type=pending)를 사용해야 함 (#668).
      await expect(page.getByTestId('child-row-100').locator('[data-status]')).toHaveAttribute(
        'data-status',
        'pending',
      );
    },
  );

  // 하위 태스크 행 hover 배경 클래스 회귀 (#305).
  // 행 컨테이너(<li>)에 hover:bg-accent/50 이 없으면 클릭 가능 영역임을 시각적으로 나타내지 못함.
  test('하위 태스크 행 컨테이너에 hover:bg-accent/50 클래스가 적용됨 (#305 회귀)', async ({
    authenticatedPage: page,
  }) => {
    const taskSummary = {
      id: 1,
      name: 'TASK',
      colorToken: 'BLUE' as const,
      icon: 'Circle' as const,
    };
    const parentIssue = {
      ...createIssue({ id: 1, number: 1, title: '부모 TASK' }),
      type: taskSummary,
    };
    const child = {
      ...createIssue({ id: 10, number: 10, title: '자식 태스크' }),
      type: makeSubtaskType(),
      parent: { number: 1, title: '부모 TASK', type: taskSummary },
    };

    await setupCommonStubs(page);

    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: {
              ...parentIssue,
              childCount: 1,
              childDoneCount: 0,
              parent: null,
              labels: [],
              attachmentCount: 0,
              assignees: [],
            },
            body: '',
            comments: [],
            history: [],
            attachments: [],
          }),
        }),
    );
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1/watchers`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1/attachments`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route(
      (url) => url.pathname === ISSUES_BASE,
      (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('parent') === '1') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse([child], null)),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([], null)),
        });
      },
    );

    await page.goto(`/projects/${KEY}/issues/1`);

    // 자식 행이 렌더링될 때까지 대기.
    const row = page.getByTestId('child-row-10');
    await expect(row).toBeVisible();

    // 행 컨테이너에 hover:bg-accent/50 클래스 존재 검증 (#305 회귀).
    const className = await row.getAttribute('class');
    expect(className).toContain('hover:bg-accent/50');
  });

  test('SUBTASK 진입 → 부모 슬롯 + 변경 → PATCH payload + 슬롯 갱신', async ({
    authenticatedPage: page,
  }) => {
    const taskSummary = {
      id: 1,
      name: 'TASK',
      colorToken: 'BLUE' as const,
      icon: 'Circle' as const,
    };
    // 초기 부모: TASK number=12. PATCH 후 number=15 로 변경.
    let currentParent: StubParent = { number: 12, title: '부모 12', type: taskSummary };
    const parentPatches = trackRequests(page, 'ANY', `${ISSUES_BASE}/5/parent`);

    await setupCommonStubs(page);

    // 이슈 상세 — SUBTASK 유형. parent 는 currentParent 기준으로 동적.
    await stubSubtaskDetail(page, () => currentParent);

    // PATCH /issues/5/parent — currentParent 갱신 + IssueDetailResponse 반환.
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/5/parent`,
      (route) => {
        const req = route.request();
        const newNumber = (req.postDataJSON() as { parentNumber: number }).parentNumber;
        currentParent = { number: newNumber, title: `부모 ${newNumber}`, type: taskSummary };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(subtaskDetailBody(currentParent)),
        });
      },
    );

    await page.goto(`/projects/${KEY}/issues/5`);

    // SUBTASK 진입 — 부모 슬롯 노출 + 변경 버튼 (parent 있음).
    await expect(page.getByTestId('issue-parent-slot')).toBeVisible();
    await expect(page.getByTestId('parent-badge-12')).toBeVisible();
    await expect(page.getByTestId('issue-parent-edit')).toHaveText('변경');

    // 편집 진입 → number 15 입력 → 저장.
    await page.getByTestId('issue-parent-edit').click();
    await expect(page.getByTestId('issue-parent-picker')).toBeVisible();
    // WP-745: SUBTASK 는 부모를 뗄 수 없다 — 비우면 저장이 막힌다.
    await page.getByTestId('parent-number-input').fill('');
    await expect(page.getByTestId('parent-save')).toBeDisabled();
    await page.getByTestId('parent-number-input').fill('15');
    await page.getByTestId('parent-save').click();

    // PATCH payload — 백엔드 컨트랙트 검증.
    await expect.poll(() => parentPatches.lastBody()).toEqual({ parentNumber: 15 });

    // 슬롯 갱신 — picker 닫히고 새 ParentBadge 노출.
    await expect(page.getByTestId('issue-parent-picker')).toHaveCount(0);
    await expect(page.getByTestId('parent-badge-15')).toBeVisible();
  });

  // WP-805 회귀: 부모 제목이 길면 레일 폭 안에서 말줄임돼야 한다 — 전에는 inline-flex 링크가 폭 제한 없이
  // 늘어나 제목 span 의 truncate 가 걸리지 않고 레일 밖(화면 끝)까지 넘쳤다.
  test('SUBTASK 상세 — 긴 부모 제목은 레일 폭 안에서 말줄임된다 (WP-805)', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const longTitle = '분기 결산 보고서 작성 — 재무팀 협업 및 경영진 검토 일정 조율';
    // 같은 레일의 보고자 값도 같은 inline-flex + truncate 구조라 긴 이름으로 함께 지킨다.
    const longReporter = '재무팀 분기 결산 자동화 담당 AI 에이전트 (경영진 보고용)';

    await setupCommonStubs(page);
    await stubSubtaskDetail(page, () => ({ number: 12, title: longTitle, type: makeTaskType() }), {
      reporter: { id: 9, username: 'ai@x', name: longReporter, kind: 'AGENT' },
    });

    await page.goto(`/projects/${KEY}/issues/5`);

    const slot = page.getByTestId('issue-parent-slot');
    const badge = page.getByTestId('parent-badge-12');
    await expect(badge).toBeVisible();

    // 전제 — 1440px 에서 레일이 오른쪽 280px 칸으로 나와 있다(좁아져 본문 아래로 내려가면 제목이 안 잘려 검증이 무의미).
    const slotBox = await slot.boundingBox();
    expect(slotBox!.width).toBeLessThanOrEqual(280);

    // 배지 오른쪽 끝이 슬롯(레일 폭) 안에 있다.
    const badgeBox = await badge.boundingBox();
    expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(slotBox!.x + slotBox!.width + 0.5);

    // 제목 span 이 실제로 잘려 말줄임 중이다(내용 폭 > 보이는 폭).
    const clipped = await badge
      .getByText(longTitle)
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(true);

    // 보고자 값도 레일 폭 안에서 말줄임된다.
    const reporter = page.getByTestId('issue-reporter');
    await expect(reporter).toBeVisible();
    const railBox = await page.getByTestId('property-rail').boundingBox();
    const reporterBox = await reporter.boundingBox();
    expect(reporterBox!.x + reporterBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width + 0.5);
    expect(
      await reporter.getByText(longReporter).evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
  });

  // WP-745: 유형을 SUBTASK 로 바꾸면 바로 저장하지 않고 부모 번호를 받아 유형·부모를 한 요청으로 보낸다.
  test('TASK → SUBTASK 유형 변경은 부모 번호를 받아 PATCH /type 에 함께 보낸다', async ({
    authenticatedPage: page,
  }) => {
    const typePatches = trackRequests(page, 'ANY', `${ISSUES_BASE}/7/type`);
    const parentPatches = trackRequests(page, 'ANY', `${ISSUES_BASE}/7/parent`);
    // PATCH /type 이 성공하면 상세가 SUBTASK + 부모 3 으로 바뀐다.
    let converted = false;
    const detail = () => ({
      summary: {
        ...createIssue({ id: 7, number: 7, title: '바꿀 TASK' }),
        type: converted ? makeSubtaskType() : makeTaskType(),
        parent: converted ? { number: 3, title: '부모 3', type: makeTaskType() } : null,
        childCount: 0,
        childDoneCount: 0,
        labels: [],
        attachmentCount: 0,
        assignees: [],
      },
      viewerCanEditContent: true,
      viewerCanEditWorkflow: true,
      body: '',
      comments: [],
      history: [],
      attachments: [],
    });

    await setupCommonStubs(page);
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/7`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail()) }),
    );
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/7/type`,
      (route) => {
        converted = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail()) });
      },
    );
    for (const sub of ['watchers', 'attachments']) {
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/7/${sub}`,
        (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
    }
    await page.route(
      (url) => url.pathname === ISSUES_BASE,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse([], null)),
        }),
    );

    await page.goto(`/projects/${KEY}/issues/7`);
    await page.getByTestId('issue-type-trigger').click();
    await page.getByTestId('issue-type-option-5').click();

    // SUBTASK 를 골라도 바로 저장하지 않는다 — 부모 번호 단계, 비어 있으면 저장 불가.
    await expect(page.getByTestId('issue-type-subtask-parent')).toBeVisible();
    await expect(page.getByTestId('issue-type-parent-save')).toBeDisabled();
    expect(typePatches.count()).toBe(0);

    await page.getByTestId('issue-type-parent-input').fill('3');
    await page.getByTestId('issue-type-parent-save').click();

    await expect.poll(() => typePatches.lastBody()).toEqual({ typeId: 5, parentNumber: 3 });
    expect(parentPatches.count()).toBe(0);
    // 팝오버가 닫히고 부모 슬롯에 새 부모가 보인다.
    await expect(page.getByTestId('issue-type-picker')).toHaveCount(0);
    await expect(page.getByTestId('parent-badge-3')).toBeVisible();
  });

  // 하위 태스크 행 AI 진행 배지(WP-374) — 행당 배지는 최대 1개: 열린 행에 AI 배지가 있으면 상태배지 대신 그것,
  // 그 외(끝난 행·AI 관여 없는 열린 행)는 상태배지.
  for (const viewport of [
    { name: '데스크톱', width: 1280, height: 800 },
    { name: '모바일 375px', width: 375, height: 800 },
  ]) {
    test(`하위 태스크 행 — AI 관여 열린 행은 AI 배지, 그 외는 상태배지 (${viewport.name})`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize(viewport);
      const taskSummary = {
        id: 1,
        name: 'TASK',
        colorToken: 'BLUE' as const,
        icon: 'Circle' as const,
      };
      const parentIssue = {
        ...createIssue({ id: 1, number: 1, title: '부모 TASK' }),
        type: taskSummary,
      };
      // 공용 하위 태스크 팩토리 — 유형·부모만 고정, 나머지는 createIssue overrides 그대로 전달.
      const subtask = (overrides: Parameters<typeof createIssue>[0]) => ({
        ...createIssue(overrides),
        type: makeSubtaskType(),
        parent: { number: 1, title: '부모 TASK', type: taskSummary },
      });
      const waitingChild = subtask({
        id: 10,
        number: 10,
        title: '답변 기다리는 하위 태스크',
        status: 'IN_PROGRESS',
        agentWork: [createAgentWork({ worker: agentWorker, state: 'INPUT_REQUIRED' })],
      });
      const plainOpenChild = subtask({
        id: 20,
        number: 20,
        title: 'AI 관여 없는 하위 태스크',
        status: 'TODO',
      });
      const notStartedChild = subtask({
        id: 40,
        number: 40,
        title: 'AI 담당인데 아직 시작 안 한 하위 태스크',
        status: 'TODO',
        assignees: [agentWorker],
      });
      // 작업 기록 없이 AI 담당만 있는 진행 중 행 — 개인 체크리스트와 동일한 「AI 위임」 배지(delegationState, WP-377).
      const delegatedChild = subtask({
        id: 50,
        number: 50,
        title: 'AI 담당, 작업 기록은 아직 없는 하위 태스크',
        status: 'IN_PROGRESS',
        assignees: [agentWorker],
      });
      const doneChild = subtask({
        id: 30,
        number: 30,
        title: '완료된 하위 태스크',
        status: 'DONE',
        // 끝난 이슈도 agentWork 가 남아있을 수 있지만(과거 작업 이력) 상태배지가 우선이어야 한다.
        agentWork: [createAgentWork({ worker: agentWorker, state: 'WORKING' })],
      });

      await setupCommonStubs(page);
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1`,
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              summary: {
                ...parentIssue,
                childCount: 5,
                childDoneCount: 1,
                parent: null,
                labels: [],
                attachmentCount: 0,
                assignees: [],
              },
              body: '',
              comments: [],
              history: [],
              attachments: [],
            }),
          }),
      );
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1/watchers`,
        (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1/attachments`,
        (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
      await page.route(
        (url) => url.pathname === ISSUES_BASE,
        (route) => {
          const url = new URL(route.request().url());
          if (url.searchParams.get('parent') === '1') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(
                createIssueSearchResponse(
                  [waitingChild, plainOpenChild, notStartedChild, delegatedChild, doneChild],
                  null,
                ),
              ),
            });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse([], null)),
          });
        },
      );

      await page.goto(`/projects/${KEY}/issues/1`);
      await expect(page.getByTestId('issue-children-section')).toBeVisible();

      // 열린 행 + AI 작업 있음 — AI 배지만, 상태배지는 없음.
      const waitingRow = page.getByTestId('child-row-10');
      await expect(waitingRow.getByTestId('ai-delegation-badge-10')).toContainText('답변 필요');
      await expect(waitingRow.locator('[data-status]')).toHaveCount(0);

      // 열린 행 + AI 관여 없음 — 상태배지(할 일), AI 배지는 없음.
      const plainRow = page.getByTestId('child-row-20');
      await expect(plainRow.locator('[data-testid^="ai-delegation-badge-"]')).toHaveCount(0);
      await expect(plainRow.locator('[data-status]')).toHaveAttribute('data-status', 'pending');

      // 열린 행 + AI 담당(아직 작업 시작 전, TODO) — 시작 전 배지(AiDelegationBadge, 개인 체크리스트와 단일 기준).
      const notStartedRow = page.getByTestId('child-row-40');
      await expect(notStartedRow.getByTestId('ai-delegation-badge-40')).toContainText('시작 전');
      await expect(notStartedRow.locator('[data-status]')).toHaveCount(0);

      // 열린 행 + AI 담당(작업 기록 없음, TODO 아님) — 「AI 위임」 배지.
      const delegatedRow = page.getByTestId('child-row-50');
      await expect(delegatedRow.getByTestId('ai-delegation-badge-50')).toContainText('AI 위임');
      await expect(delegatedRow.locator('[data-status]')).toHaveCount(0);

      // 끝난 행 — agentWork 가 있어도 상태배지(완료)가 우선, AI 배지는 없음.
      const doneRow = page.getByTestId('child-row-30');
      await expect(doneRow.locator('[data-status]')).toHaveAttribute('data-status', 'success');
      await expect(doneRow.locator('[data-testid^="ai-delegation-badge-"]')).toHaveCount(0);    });
  }
});

// WP-467 — 응답을 기다리는 동안 친 다음 제목을 첫 생성 응답이 지우면 안 된다.
test.describe('하위 태스크 연속 추가', () => {
  test('첫 생성 응답 전에 입력한 다음 제목이 그대로 남아 이어서 추가된다', async ({
    authenticatedPage: page,
  }) => {
    const taskSummary = { id: 1, name: 'TASK', colorToken: 'BLUE' as const, icon: 'Circle' as const };
    const parentIssue = { ...createIssue({ id: 1, number: 1, title: '부모 TASK' }), type: taskSummary };
    const creates = trackRequests(page, 'POST', ISSUES_BASE);
    // 첫 POST 응답을 붙잡아 두는 관문 — 그 사이 사용자가 다음 제목을 친다.
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((r) => (releaseFirst = r));
    let created = 0;

    await setupCommonStubs(page);
    await page.route(
      (url) => url.pathname === `${ISSUES_BASE}/1`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            summary: { ...parentIssue, childCount: 0, childDoneCount: 0, parent: null, labels: [], attachmentCount: 0, assignees: [] },
            body: '',
            comments: [],
            history: [],
            attachments: [],
          }),
        }),
    );
    for (const sub of ['watchers', 'attachments']) {
      await page.route(
        (url) => url.pathname === `${ISSUES_BASE}/1/${sub}`,
        (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
    }
    await page.route(
      (url) => url.pathname === ISSUES_BASE,
      async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse([], null)),
          });
        }
        const { title } = req.postDataJSON() as { title: string };
        const n = 100 + created++;
        if (n === 100) await firstGate;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...createIssue({ id: n, number: n, title }), type: makeSubtaskType() }),
        });
      },
    );

    await page.goto(`/projects/${KEY}/issues/1`);
    const input = page.getByTestId('child-add-input');
    await input.fill('Alpha');
    await input.press('Enter');
    await creates.waitFor(1);
    // 첫 응답 전에 다음 제목을 친다.
    await input.pressSequentially('Bravo');
    releaseFirst();
    await expect(page.getByText('하위 태스크를 추가했습니다')).toBeVisible();
    // 첫 응답이 와도 입력 중이던 다음 제목은 지워지지 않는다.
    await expect(input).toHaveValue('Bravo');
    await input.press('Enter');
    await creates.waitFor(2);
    expect(creates.bodies<{ title: string }>().map((b) => b.title)).toEqual(['Alpha', 'Bravo']);
    await expect(input).toHaveValue('');
  });
});
