// SUBTASK 도메인 E2E — 실제 레일 폭에서 긴 부모 제목·보고자가 말줄임되는지(WP-805, @layout)만 남긴다.
// 인라인 추가 POST·목록 갱신, 행 hover 클래스, 부모 변경 PATCH, TASK → SUBTASK 유형 변경, 행 AI 배지(데스크톱·모바일),
// 응답 전 입력한 다음 제목 보존(WP-467)은 페이지 테스트 src/pages/projects/subtasks.test.tsx·subtasksMobile.test.tsx 가 지킨다(WP-980).

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
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
  // WP-805 회귀: 부모 제목이 길면 레일 폭 안에서 말줄임돼야 한다 — 전에는 inline-flex 링크가 폭 제한 없이
  // 늘어나 제목 span 의 truncate 가 걸리지 않고 레일 밖(화면 끝)까지 넘쳤다.
  test('SUBTASK 상세 — 긴 부모 제목은 레일 폭 안에서 말줄임된다 (WP-805)', { tag: '@layout' }, async ({
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
});
