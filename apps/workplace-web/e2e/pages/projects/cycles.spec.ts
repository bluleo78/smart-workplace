// 사이클 관리 E2E — 목록+진행바 배선 1건(@wiring)과 실제 오프라인 저장(@platform)만 남긴다.
// 진행바 색 칸·헤더 복귀·생성(입력 상한)·날짜 역전·수정·삭제, 이슈 상세 사이클 피커, 목록 사이클 필터는
// 페이지 테스트 src/pages/projects/cycles.test.tsx 가 지킨다(WP-971).
import { expect, test } from '../../fixtures/auth.fixture';
import { expectStays } from '../../fixtures/wait';
import { createProject } from '../../factories/project.factory';
import type { CycleProgress, CycleResponse } from '../../../src/types/cycle';

const KEY = 'WP';

// 테스트용 사이클 팩토리.
function createCycle(overrides: Partial<CycleResponse> = {}): CycleResponse {
  const now = new Date().toISOString();
  return {
    id: 1,
    projectId: 1,
    name: '스프린트 1',
    goal: null,
    startDate: null,
    endDate: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// 사이클 페이지 공통 스텁 — project·cycles·progress 를 mock.
async function setupCyclesPageStubs(
  page: import('@playwright/test').Page,
  cycles: CycleResponse[],
  progress: CycleProgress[],
) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );

  await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(cycles),
    });
  });

  await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(progress),
    });
  });
}

test.describe('사이클 관리', () => {
  test(
    '목록 + 진행바 렌더 — ACTIVE 사이클과 1/4 완료(25%) 진행바 표시',
    { tag: ['@wiring', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      const cycle = createCycle({ id: 1, name: '스프린트 1', status: 'ACTIVE' });
      const progress: CycleProgress = {
        cycleId: 1,
        total: 4,
        done: 1,
        byStatus: { DONE: 1, TODO: 3 },
      };

      await setupCyclesPageStubs(page, [cycle], [progress]);
      await page.goto(`/projects/${KEY}/cycles`);

      // 사이클 행이 렌더되고 이름이 표시된다.
      await expect(page.getByTestId('cycle-row-1')).toBeVisible();
      await expect(page.getByTestId('cycle-row-1')).toContainText('스프린트 1');
      // 상태는 영문 enum 대신 한국어 라벨(매핑 전체는 cycleMeta.test 의 CYCLE_STATUS_LABEL 단위 테스트, WP-412).
      await expect(page.getByTestId('cycle-row-1')).toContainText('진행 중');
      await expect(page.getByTestId('cycle-row-1')).not.toContainText('ACTIVE');

      // 진행바가 1/4 완료 (25%) 텍스트를 표시한다.
      await expect(page.getByTestId('cycle-progress-1')).toContainText('1/4 완료 (25%)');
    },
  );

  // WP-927 — 오프라인에서 저장하면 요청을 멈춰 두지 않고 바로 실패를 알린다. 대화상자를 닫은 뒤 다시 연결돼도
  // 취소한 줄 안 저장이 뒤늦게 나가지 않는다(TanStack Query 변경 기본 networkMode 'online' 이 요청을 쌓아 두던 문제).
  test('오프라인에서 저장하면 연결 확인 안내를 보이고, 닫은 뒤 다시 연결돼도 저장이 뒤늦게 나가지 않는다 (WP-927)', { tag: '@platform' }, async ({
    authenticatedPage: page,
  }) => {
    await setupCyclesPageStubs(page, [], []);
    // 서버까지 닿은 생성 요청 수. 브라우저 오프라인(setOffline)이어도 page.route 스텁은 요청을 받으므로,
    // 오프라인 동안의 요청은 연결 끊김(internetdisconnected)으로 끊어 실제 오프라인과 같게 만든다.
    let offline = false;
    let created = 0;
    await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      if (offline) return route.abort('internetdisconnected');
      created += 1;
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });
    await page.goto(`/projects/${KEY}/cycles`);
    await expect(page.getByText('아직 사이클이 없습니다.')).toBeVisible();

    await page.getByTestId('cycle-new').click();
    const dialog = page.getByTestId('cycle-form-dialog');
    await page.getByTestId('cycle-name-input').fill('오프라인 사이클');
    offline = true;
    await page.context().setOffline(true);
    await page.getByTestId('cycle-submit').click();

    // 바로 실패를 알리고, 무엇이 실패했는지와 연결 확인 안내를 함께 보인다. 대화상자는 열린 채라 입력이 남는다.
    await expect(page.getByText('사이클 생성에 실패했습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요')).toBeVisible();
    await expect(page.getByTestId('cycle-name-input')).toHaveValue('오프라인 사이클');

    // 취소하고 다시 연결 — 멈춰 둔 저장이 없으므로 생성 요청은 서버에 닿지 않는다.
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toBeHidden();
    offline = false;
    await page.context().setOffline(false);
    // 「다시 연결된 뒤 일어나지 않음」 확인 — 예전에는 연결 직후 바로 나갔으므로 1초면 충분하다.
    await expectStays(page, () => created, 0, { ms: 1000 });
  });


});
