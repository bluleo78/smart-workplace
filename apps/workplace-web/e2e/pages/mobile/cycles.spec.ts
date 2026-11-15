// 모바일 사이클(WP-197) — 2줄 요약(날짜 · 진행%), goal 1줄, 연필·휴지통 대신 ⋯ → 액션 시트, 행 탭 = 그 사이클 이슈 목록.
// 브라우저가 있어야 판정되는 말줄임·넘침·⋯ 44px 만 남긴다. ⋯ → 삭제(취소·확인 DELETE)와 행 탭 이동은
// 페이지 테스트 src/pages/mobile/cycles.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test';

import type { CycleProgress, CycleResponse } from '../../../src/types/cycle';
import { createIssueSearchResponse } from '../../factories/issue.factory';
import { systemTypes } from '../../factories/issueType.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { json } from '../../fixtures/mobile-chat';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';
import { trackRequests } from '../../fixtures/requests';

const KEY = 'WP';
const now = new Date().toISOString();
const cycle = (o: Partial<CycleResponse>): CycleResponse => ({
  id: 1, projectId: 1, name: '스프린트', goal: null, startDate: null, endDate: null, status: 'ACTIVE', createdAt: now, updatedAt: now, ...o,
});
const CYCLES = [
  cycle({ id: 1, name: '2026 4분기 결제 모듈 재구축 1차 스프린트 — 이름이 아주 긴 사이클', goal: '결제 승인 실패율을 0.5% 미만으로 낮추고 정산 배치를 신규 파이프라인으로 이관한다', startDate: '2026-09-29', endDate: '2026-10-10', status: 'ACTIVE' }),
  cycle({ id: 2, name: '시작만', startDate: '2026-10-13', status: 'PLANNED' }),
  cycle({ id: 3, name: '끝만', endDate: '2026-10-31', status: 'PLANNED' }),
  cycle({ id: 4, name: '날짜 없음', status: 'COMPLETED' }),
];
const PROGRESS: CycleProgress[] = [{ cycleId: 1, total: 20, done: 9, byStatus: { DONE: 9, TODO: 11 } }];

async function setup(page: Page, cycles: CycleResponse[] = CYCLES) {
  const deletes = trackRequests(page, 'DELETE', /\/api\/v1\/projects\/WP\/cycles\/\d+$/);
  await stubChat(page);
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/cycles`, (r) => r.fulfill(json(cycles)));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/cycles/progress`, (r) => r.fulfill(json(PROGRESS)));
  await page.route((u) => /\/api\/v1\/projects\/WP\/cycles\/\d+$/.test(u.pathname), (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback();
    return r.fulfill({ status: 204 });
  });
  // 행 탭 후 도착하는 프로젝트 상세의 최소 스텁 — 미스텁 요청이 프록시로 새지 않게.
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => r.fulfill(json(createIssueSearchResponse([], null))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  // 사이클 수정·삭제는 프로젝트 OWNER 만 보인다(WP-1008) — 로그인 사용자(id 1)를 OWNER 로 둔다.
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json([createMember({ userId: 1, role: 'OWNER' })])));
  await page.route((u) => [`/api/v1/projects/${KEY}/labels`, `/api/v1/projects/${KEY}/milestones`, `/api/v1/projects/${KEY}/saved-views`].includes(u.pathname), (r) => r.fulfill(json([])));
  await page.goto(`/projects/${KEY}/cycles`);
  await expect(page.getByTestId('cycle-row-1')).toBeVisible();
  return { deletes };
}

// 시작만/끝만/날짜 없음/이슈 0건 문구 규칙은 cycleMeta.test(cycleMetaText)가 지킨다 — 여기선 2줄째 배선과 모바일 레이아웃만.
test('2줄째 = 날짜 · 진행, goal 1줄, 진행 막대 숨김, 넘침 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page);
  await expect(page.getByTestId('cycle-row-meta-1')).toHaveText('9월 29일 ~ 10월 10일 · 45%');
  await expect(page.getByTestId('cycle-row-1')).toContainText('진행 중'); // 상태는 배지에만
  const goal = page.getByTestId('cycle-row-1').getByText(/결제 승인 실패율/);
  expect(await goal.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // 1줄 말줄임
  await expect(page.getByTestId('cycle-row-1').getByText(/완료 \(45%\)/)).toHaveCount(0); // CycleProgressBar 미렌더
  await expectNoHorizontalOverflow(page);
});

test('⋯(44px) → 수정 → 기존 사이클 폼이 값 채워 열린다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page);
  const more = page.getByTestId('cycle-more-1');
  const mb = (await more.boundingBox())!;
  expect(mb.width).toBeGreaterThanOrEqual(44);
  expect(mb.height).toBeGreaterThanOrEqual(44);
  await more.tap();
  const sheet = page.getByTestId('cycle-sheet');
  await sheet.getByTestId('mobile-action-edit').tap();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('cycle-form-dialog')).toBeVisible();
  await expect(page.getByTestId('cycle-name-input')).toHaveValue(CYCLES[0].name);
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/cycles$`)); // ⋯ 는 행 이동을 일으키지 않는다
});

// WP-1605 — 390px 에서 새 사이클 창이 가로로 넘치지 않는다. DialogContent(grid)의 암묵 열이 날짜 행(date input 둘)의 min-content 만큼
// 커져 본문이 창 안쪽 폭보다 38px 넓어지고 가로 스크롤바가 생겼다. 기하라 jsdom 으로는 잴 수 없다.
test('새 사이클 창 — 390px 에서 가로로 넘치지 않고 입력·버튼이 창 안쪽에 든다 (WP-1605)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page);
  await page.getByTestId('cycle-new').tap();
  const dialog = page.getByTestId('cycle-form-dialog');
  await expect(dialog).toBeVisible();
  // 열림 애니메이션(zoom-in) 중에는 상자 크기가 변하므로 애니메이션이 끝나 자리 잡은 뒤 한 번 잰다.
  await expect.poll(() => dialog.evaluate((el) => el.getAnimations().length)).toBe(0);
  const { scrollWidth, clientWidth, innerRight } = await dialog.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    // 안쪽 오른쪽 끝 = 테두리 상자 왼쪽 + 왼쪽 테두리 + clientWidth(패딩 포함, 스크롤바·테두리 제외).
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, innerRight: rect.left + el.clientLeft + el.clientWidth };
  });
  expect(scrollWidth, `dialog scrollWidth ${scrollWidth} vs clientWidth ${clientWidth}`).toBeLessThanOrEqual(clientWidth);
  const targets = [
    page.getByTestId('cycle-name-input'),
    dialog.getByLabel('시작일'),
    dialog.getByLabel('종료일'),
    dialog.getByRole('button', { name: '취소' }),
    page.getByTestId('cycle-submit'),
  ];
  for (const t of targets) {
    const b = (await t.boundingBox())!;
    expect(b.x + b.width, `${t} right ${b.x + b.width} vs dialog inner right ${innerRight}`).toBeLessThanOrEqual(innerRight + 0.5);
  }
});

// 사이클 완료 창(WP-1606) — 미완료를 새 사이클로 보낼 때 펼치는 칸(기간 날짜 입력 2개)의 최소 너비가 창 안쪽을 넘어
// 390px 에서 창이 가로로 스크롤되던 결함. 창은 fixed 라 문서 폭이 아니라 창 자신의 넘침·가장자리를 잰다(jsdom 은 못 잰다).
test('사이클 완료 창 — 새 사이클 칸(기간 날짜 2개)이 390px 창 안에 들어간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 짧은 이름(제목 넘침과 섞이지 않게) · 끝 숫자 없음(추천 이름 없음 → 칸이 처음부터 펼쳐짐) · 예정 사이클 없음(보낼 곳 = 새 사이클).
  await setup(page, [cycle({ id: 1, name: '결제 스프린트', startDate: '2026-09-29', endDate: '2026-10-10', status: 'ACTIVE' })]);
  await page.getByTestId('cycle-more-1').tap();
  await page.getByTestId('cycle-sheet').getByTestId('mobile-action-complete').tap();
  const dialog = page.getByTestId('cycle-complete-dialog');
  const end = dialog.getByLabel('새 사이클 종료일');
  await expect(end).toBeVisible();
  // 열림 애니메이션(zoom-in)이 끝나 자리 잡을 때까지 다시 잰다. 창은 grid 스크롤 컨테이너라 내용이 오른쪽 패딩을
  // 침범해도 scrollWidth 가 커진다 — 종료일 칸이 잘리거나 패딩에 걸치는 것까지 이 한 줄로 잡힌다.
  await expect.poll(() => dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  // 날짜 칸은 한 줄씩 쌓여 칸마다 패널 폭을 다 쓴다 — 나란히 두면 126px 로 줄어 연도가 칸 안에서 잘렸다.
  // (잘림은 date 입력 내부라 scrollWidth 로는 보이지 않아 칸의 자리·폭으로 본다.)
  const sb = (await dialog.getByLabel('새 사이클 시작일').boundingBox())!;
  const eb = (await end.boundingBox())!;
  expect(eb.y).toBeGreaterThanOrEqual(sb.y + sb.height);
  expect(eb.width).toBeGreaterThan(200);
});
