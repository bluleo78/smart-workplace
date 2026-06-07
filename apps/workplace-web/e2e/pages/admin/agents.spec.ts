// /admin/agents — AGENT 유저 + API 키 관리 페이지 E2E (@smoke).
// 시나리오: ADMIN 으로 진입 → 신규 AGENT 생성 → 행 선택 → 키 발급 →
// 평문 dialog 노출 (ak_) → 닫기 → 회수 → revoked_at 표시.
// #136: window.confirm → AlertDialog 교체 검증 포함.

import { expect, test } from '../../fixtures/auth.fixture';

// 단일 AGENT + API 키가 존재하는 상태를 셋업한다 — AlertDialog 경로 테스트용.
const AGENT_ID = 100;
const KEY_ID = 1;

interface AgentKeyFixture {
  id: number;
  userId: number;
  keyPrefix: string;
  label: string | null;
  createdBy: number;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const AGENTS_FIXTURE = [
  {
    id: AGENT_ID,
    username: 'claude_bot',
    name: 'Claude 봇',
    email: 'claude@bot.local',
    kind: 'AGENT' as const,
    isActive: true,
    createdAt: '2026-05-20T09:00:00Z',
  },
];
const KEYS_FIXTURE: AgentKeyFixture[] = [
  {
    id: KEY_ID,
    userId: AGENT_ID,
    keyPrefix: 'ak_test1',
    label: 'worker-1',
    createdBy: 1,
    createdAt: '2026-05-20T09:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
  },
];

async function setupStatic(page: import('@playwright/test').Page) {
  // agents 목록 + 단건 키 미리 로드 (immutable fixture).
  let keys: AgentKeyFixture[] = [...KEYS_FIXTURE];
  let deleteCount = 0;
  let revokeCount = 0;

  await page.route(/\/api\/v1\/admin\/agents$/, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(AGENTS_FIXTURE),
      });
    }
    return route.fallback();
  });
  await page.route(/\/api\/v1\/admin\/agents\/\d+$/, (route) => {
    if (route.request().method() === 'DELETE') {
      deleteCount += 1;
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fallback();
  });
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(keys),
      });
    }
    return route.fallback();
  });
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys\/\d+$/, (route) => {
    if (route.request().method() === 'DELETE') {
      revokeCount += 1;
      keys = keys.map((k) =>
        k.id === KEY_ID ? { ...k, revokedAt: new Date().toISOString() } : k,
      );
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fallback();
  });
  // oauth-token 없음 (404)
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/oauth-token$/, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: '없음' }),
      });
    }
    return route.fallback();
  });

  return { getDeleteCount: () => deleteCount, getRevokeCount: () => revokeCount };
}

test.describe('/admin/agents', () => {
  test(
    'AGENT 생성 → 키 발급 → 평문 표시 → 회수',
    { tag: '@smoke' },
    async ({ adminPage: page }) => {
      // 상태 저장소 — 라우트 핸들러가 mutation 결과를 누적한다.
      let agents: Array<{
        id: number;
        username: string;
        name: string;
        email: string;
        kind: 'HUMAN' | 'AGENT';
        isActive: boolean;
        createdAt: string;
      }> = [];
      let keys: Array<{
        id: number;
        userId: number;
        keyPrefix: string;
        label: string | null;
        createdBy: number;
        createdAt: string;
        lastUsedAt: string | null;
        revokedAt: string | null;
      }> = [];
      let nextAgentId = 100;
      let nextKeyId = 1;

      // /admin/agents 컬렉션 — GET 목록 + POST 생성.
      await page.route(/\/api\/v1\/admin\/agents$/, (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(agents),
          });
        }
        if (method === 'POST') {
          const body = route.request().postDataJSON() as {
            username: string;
            name: string;
            email: string;
          };
          const a = {
            id: nextAgentId++,
            username: body.username,
            name: body.name,
            email: body.email,
            kind: 'AGENT' as const,
            isActive: true,
            createdAt: new Date().toISOString(),
          };
          agents = [...agents, a];
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(a),
          });
        }
        return route.fallback();
      });

      // /admin/agents/{userId}/keys — GET 목록 + POST 발급.
      await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (route) => {
        const m = route.request().url().match(/agents\/(\d+)\/keys/);
        const uid = m ? Number(m[1]) : 0;
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(keys.filter((k) => k.userId === uid)),
          });
        }
        if (method === 'POST') {
          const body = route.request().postDataJSON() as {
            label: string | null;
          };
          const id = nextKeyId++;
          const k = {
            id,
            userId: uid,
            keyPrefix: `ak_test${id}`,
            label: body.label,
            createdBy: 1,
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            revokedAt: null,
          };
          keys = [...keys, k];
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id,
              userId: uid,
              plaintextKey: `ak_PLAINTEXT_${id}_xy`,
              keyPrefix: k.keyPrefix,
              label: body.label,
              createdAt: k.createdAt,
            }),
          });
        }
        return route.fallback();
      });

      // /admin/agents/{userId}/keys/{keyId} — DELETE revoke.
      await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys\/\d+$/, (route) => {
        if (route.request().method() === 'DELETE') {
          const m = route.request().url().match(/keys\/(\d+)$/);
          const kid = m ? Number(m[1]) : 0;
          keys = keys.map((k) =>
            k.id === kid ? { ...k, revokedAt: new Date().toISOString() } : k,
          );
          return route.fulfill({ status: 204, body: '' });
        }
        return route.fallback();
      });

      // 1) 페이지 진입 + 신규 AGENT 다이얼로그 열기
      await page.goto('/settings/agents');
      await expect(
        page.getByRole('heading', { name: 'AGENT 관리' }),
      ).toBeVisible();

      await page.getByTestId('new-agent-trigger').click();
      await page.getByLabel('username').fill('claude_bot');
      await page.getByLabel('이름').fill('Claude 봇');
      await page.getByLabel('email').fill('claude@bot.local');
      await page.getByRole('button', { name: '생성' }).click();

      // 2) 새 AGENT 가 목록에 노출되고 → 행 선택
      const row = page.getByTestId(/^agent-row-\d+$/).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('Claude 봇');
      await row.click();

      // 3) 키 label 입력 → "키 발급" 클릭
      await page.getByLabel('키 label').fill('worker-1');
      await page.getByRole('button', { name: '키 발급' }).click();

      // 4) 평문 dialog + ak_ 접두어 확인
      await expect(page.getByTestId('agent-key-issue-dialog')).toBeVisible();
      await expect(page.getByTestId('agent-key-plaintext')).toContainText(
        'ak_PLAINTEXT_',
      );

      // 5) dialog 닫기 — Escape (헤더 X 버튼 aria-label 도 "닫기" 라 ambiguous)
      await page.keyboard.press('Escape');
      await expect(
        page.getByTestId('agent-key-issue-dialog'),
      ).not.toBeVisible();

      // 6) 키 목록 행이 prefix 와 함께 노출
      const keyRow = page.getByTestId(/^key-row-\d+$/).first();
      await expect(keyRow).toBeVisible();
      await expect(keyRow).toContainText('ak_test');

      // 7) 회수 — AlertDialog 확인 → revoked_at 표시 (회수 버튼이 사라짐). (#136: window.confirm → AlertDialog)
      const revokeBtn = page.getByTestId(/^key-revoke-\d+$/).first();
      await revokeBtn.click();
      await expect(page.getByTestId('agent-confirm-dialog')).toBeVisible();
      await page.getByTestId('agent-confirm-confirm').click();
      await expect(revokeBtn).toHaveCount(0);
    },
  );

  // #136: API 키 회수 AlertDialog 취소 → DELETE 없음.
  test('API 키 회수 AlertDialog 취소 → DELETE 호출 없음', async ({ adminPage: page }) => {
    const counts = await setupStatic(page);
    await page.goto('/settings/agents');
    await expect(page.getByRole('heading', { name: 'AGENT 관리' })).toBeVisible();
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();
    const revokeBtn = page.getByTestId(`key-revoke-${KEY_ID}`);
    await expect(revokeBtn).toBeVisible();

    // AlertDialog 열기 → 취소
    await revokeBtn.click();
    await expect(page.getByTestId('agent-confirm-dialog')).toBeVisible();
    await page.getByTestId('agent-confirm-cancel').click();
    await expect(page.getByTestId('agent-confirm-dialog')).not.toBeVisible();

    expect(counts.getRevokeCount()).toBe(0);
    await expect(revokeBtn).toBeVisible();
  });

  // #136: AGENT 삭제 AlertDialog 확인 → DELETE 호출.
  test('AGENT 삭제 AlertDialog 확인 → DELETE 호출', async ({ adminPage: page }) => {
    const counts = await setupStatic(page);
    await page.goto('/settings/agents');
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();
    const deleteBtn = page.getByTestId(`agent-delete-${AGENT_ID}`);
    await expect(deleteBtn).toBeVisible();

    await deleteBtn.click();
    await expect(page.getByTestId('agent-confirm-dialog')).toBeVisible();
    await page.getByTestId('agent-confirm-confirm').click();

    expect(counts.getDeleteCount()).toBe(1);
  });

  // #136: AGENT 삭제 AlertDialog 취소 → DELETE 없음.
  test('AGENT 삭제 AlertDialog 취소 → DELETE 호출 없음', async ({ adminPage: page }) => {
    const counts = await setupStatic(page);
    await page.goto('/settings/agents');
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();
    const deleteBtn = page.getByTestId(`agent-delete-${AGENT_ID}`);
    await expect(deleteBtn).toBeVisible();

    await deleteBtn.click();
    await expect(page.getByTestId('agent-confirm-dialog')).toBeVisible();
    await page.getByTestId('agent-confirm-cancel').click();
    await expect(page.getByTestId('agent-confirm-dialog')).not.toBeVisible();

    expect(counts.getDeleteCount()).toBe(0);
    await expect(deleteBtn).toBeVisible();
  });
});
