// /settings/agents/accounts — AI 계정 표 칸 배치(WP-1465) E2E. 태블릿 폭(1024)에서 유형 배지가 옆 5시간 칸을 덮고
// 고정 비율 칸이 한글 낱말을 가운데서 끊던 결함이 다시 생기지 않게, 실제 브라우저에서 칸 상자끼리 겹치지 않는지 잰다(@layout — jsdom 은 기하를 못 잰다).
// 칸 문구·상태 판정은 src/pages/admin/agentAccounts.test.tsx(vitest)가 지킨다.
import { type Locator, type Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createAccount, createUsage } from '../../../src/test/kits/admin/agentAccounts';
import type { AgentAccountResponse } from '../../../src/types/agentAccount';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** 지금부터 ms 뒤 ISO 시각 — 화면 시계(useMinuteNow)가 실제 시각이라 초기화 시각도 실제 시각 기준으로 만든다. */
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** 겹침이 잘 드러나는 줄 모음 — 긴 실패 이유·긴 한글 라벨·한도 없는 줄(두 칸 합침)·다시 로그인 필요가 섞여 칸 폭이 고르지 않다. */
function accounts(): AgentAccountResponse[] {
  const ago = fromNow(-3 * MIN);
  return [
    createAccount({
      id: 1,
      provider: 'chatgpt',
      label: 'ChatGPT 개발',
      accountEmail: 'dev@example.com',
      status: 'NEEDS_CHECK',
      usage: createUsage({ status: 'CHECK_FAILED', checkedAt: ago, errorCode: 'NETWORK', errorMessage: '연결 실패' }),
    }),
    createAccount({
      id: 2,
      label: 'Claude 팀 A',
      usage: createUsage({
        status: 'OK',
        weekly: { usedPercent: 63, resetsAt: fromNow(2 * DAY), observedAt: ago },
        checkedAt: ago,
        succeededAt: ago,
        lastUsedAt: ago,
      }),
    }),
    createAccount({
      id: 3,
      label: 'Claude 팀 B',
      usage: createUsage({
        status: 'NEAR_LIMIT',
        fiveHour: { usedPercent: 4, resetsAt: fromNow(3 * 60 * MIN), observedAt: ago },
        weekly: { usedPercent: 93, resetsAt: fromNow(3 * DAY), observedAt: ago },
        checkedAt: ago,
        succeededAt: ago,
      }),
    }),
    createAccount({ id: 4, provider: 'opencode', label: '사내 모델', usage: createUsage({ status: 'UNLIMITED', lastUsedAt: ago }) }),
    createAccount({ id: 5, provider: 'genia', label: 'Gen:iA 운영', status: 'RELOGIN_REQUIRED', usage: createUsage({ status: 'RELOGIN_REQUIRED' }) }),
    createAccount({ id: 6, label: 'Claude 오래된 토큰', agents: [], usage: createUsage() }),
  ];
}

/**
 * 줄 안의 보이는 칸(td)들의 가로 범위와 칸 안 내용의 가장 오른쪽 끝 — display:none 칸은 상자가 없어 빠진다.
 * 표 칸 상자 자체는 서로 겹치지 않으니(table-fixed 는 칸을 늘리지 않고 내용을 넘치게 둔다) 내용(배지·문구 요소)의 오른쪽 끝도 함께 잰다.
 */
async function visibleCellBoxes(row: Locator) {
  return row.evaluate((tr) =>
    Array.from(tr.children)
      .map((td) => {
        const box = td.getBoundingClientRect();
        const contentRight = Math.max(box.left, ...Array.from(td.querySelectorAll('*')).map((el) => el.getBoundingClientRect().right));
        return { left: box.left, right: box.right, width: box.width, contentRight };
      })
      .filter((b) => b.width > 0),
  );
}

/** 칸 겹침 판정 — 앞 칸의 오른쪽 끝(칸 상자·칸 안 내용 모두)이 다음 칸 왼쪽 끝을 1px 넘게 넘으면 겹친 것. */
async function expectNoOverlap(page: Page, ids: number[]) {
  for (const id of ids) {
    const boxes = await visibleCellBoxes(page.getByTestId(`agent-account-row-${id}`));
    expect(boxes.length, `줄 ${id} 의 보이는 칸`).toBeGreaterThan(1);
    for (let i = 0; i + 1 < boxes.length; i++) {
      expect(boxes[i].right, `줄 ${id} 칸 ${i} → ${i + 1}`).toBeLessThanOrEqual(boxes[i + 1].left + 1);
      expect(boxes[i].contentRight, `줄 ${id} 칸 ${i} 내용 → 칸 ${i + 1}`).toBeLessThanOrEqual(boxes[i + 1].left + 1);
    }
  }
}

/** 배지가 제 칸 안에 들어 있는지 — 칸 상자는 늘어나도 내용은 넘칠 수 있어(table-fixed) 배지 상자를 칸 상자와 비교한다. */
async function expectInside(inner: Locator, outer: Locator, what: string) {
  const a = await inner.boundingBox();
  const b = await outer.boundingBox();
  expect(a && b, what).toBeTruthy();
  if (!a || !b) return;
  expect(a.x, `${what} 왼쪽`).toBeGreaterThanOrEqual(b.x - 1);
  expect(a.x + a.width, `${what} 오른쪽`).toBeLessThanOrEqual(b.x + b.width + 1);
}

const ROWS = accounts();
const IDS = ROWS.map((a) => a.id);

test.describe('/settings/agents/accounts 표 칸 배치', () => {
  test.beforeEach(async ({ adminPage: page }) => {
    await page.route('**/api/v1/admin/agent-accounts', (r) => (r.request().method() === 'GET' ? r.fulfill(json(ROWS)) : r.fallback()));
  });

  // xl 이상 — 유형 칸이 보인다. 1280 은 xl 이 시작되는 가장 좁은 폭이라 고정 비율 칸이 가장 좁다(배지가 넘치기 가장 쉽다).
  for (const width of [1280, 1440]) {
    test(`${width} — 칸이 겹치지 않고 유형 배지는 유형 칸 안에 있다`, { tag: '@layout' }, async ({ adminPage: page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/settings/agents/accounts');
      await expect(page.getByTestId('agent-account-row-6')).toBeVisible();
      await expectNoOverlap(page, IDS);
      await expect(page.getByRole('columnheader', { name: '유형' })).toBeVisible();
      for (const id of IDS) {
        const cell = page.getByTestId(`agent-account-type-${id}`);
        await expectInside(cell.locator('[data-slot="badge"]'), cell, `줄 ${id} 유형 배지`);
      }
    });
  }

  test('1024 — 유형 칸을 숨기고 배지는 계정 칸 안, 칸이 겹치지 않는다', { tag: '@layout' }, async ({ adminPage: page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/settings/agents/accounts');
    await expect(page.getByTestId('agent-account-row-6')).toBeVisible();
    await expectNoOverlap(page, IDS);
    await expect(page.getByRole('columnheader', { name: '유형' })).toBeHidden();
    for (const id of IDS) {
      const row = page.getByTestId(`agent-account-row-${id}`);
      const badge = page.getByTestId(`agent-account-type-badge-${id}`);
      await expect(badge).toBeVisible();
      await expectInside(badge, row.locator('td').first(), `줄 ${id} 이름 옆 배지`);
    }
  });
});
