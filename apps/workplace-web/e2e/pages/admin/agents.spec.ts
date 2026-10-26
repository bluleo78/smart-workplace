// /admin/agents — AGENT 유저 + API 키 관리 페이지 E2E (@smoke).
// 시나리오: ADMIN 으로 진입 → 신규 AGENT 생성 → 행 선택 → 키 발급 →
// 평문 dialog 노출 (ak_) → 닫기 → 회수 → revoked_at 표시.
// #136: window.confirm → AlertDialog 교체 검증 포함. 에이전트 화면의 대표 배선(@wiring)과 행 키보드 진입(@input)만 남는다.
// 생성일 포맷·키 회수 취소·삭제/사용 중지 토스트·이름·아이디·설명 PUT 은 src/pages/admin/agentManagement.test.tsx 가 지킨다(WP-966).

import { expect, test } from '../../fixtures/auth.fixture';

// 단일 AGENT + API 키가 존재하는 상태 — 키보드 진입 테스트용.
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

// 키보드 진입 테스트용 — 목록·키·자격증명(없음)·공통 비서(미지정) 조회만 깐다.
async function setupStatic(page: import('@playwright/test').Page) {
  // includePersonal 기본값이 true 로 바뀌어 목록 조회가 항상 쿼리스트링을 동반하므로
  // 경로만 매칭(쿼리 유무 무관)하도록 정규식을 완화한다.
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AGENTS_FIXTURE) })
      : route.fallback(),
  );
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(KEYS_FIXTURE) }),
  );
  // provider-credential 없음 (404)
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: '없음' }) }),
  );
  // 공통 비서 — 미지정 상태(빈 상태 배너 방지용 최소 모킹).
  await page.route('**/api/v1/admin/workspace-assistant', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null }),
    }),
  );
}

test.describe('/admin/agents', () => {
  test(
    'AGENT 생성 → 키 발급 → 평문 표시 → 회수',
    { tag: ['@wiring', '@smoke'] },
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
      // includePersonal 기본값이 true 로 바뀌어 GET 이 쿼리스트링을 동반하므로 경로만 매칭.
      await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (route) => {
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

      // 공통 비서 — 미지정 상태(빈 상태 배너 + WorkspaceAssistantSection용).
      await page.route('**/api/v1/admin/workspace-assistant', (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              agentUserId: null,
              agentName: null,
              hasActiveToken: false,
              model: null,
              thinkingDepth: null,
            }),
          });
        }
        return route.fallback();
      });
      // 자격증명 없음(404) — WorkspaceAssistantSection 토큰게이트용.
      await page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ message: '없음' }),
          });
        }
        return route.fallback();
      });

      // 1) 페이지 진입 + 신규 AGENT 다이얼로그 열기
      await page.goto('/settings/agents');
      await expect(
        page.getByRole('heading', { name: '에이전트' }),
      ).toBeVisible();

      await page.getByTestId('new-agent-trigger').click();
      // 이름 칸은 저장 한도(user.name 50자)까지만 받는다(WP-670) — 100 이면 51자부터 서버가 409 로 거절했다.
      await expect(page.getByLabel('이름')).toHaveAttribute('maxlength', '50');
      await page.getByLabel('아이디').fill('claude_bot');
      await page.getByLabel('이름').fill('Claude 봇');
      await page.getByLabel('이메일').fill('claude@bot.local');
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

  // #810 — 행이 클릭 전용(role/tabIndex/onKeyDown 부재)이라 키보드로는 상세 드로어에 진입 불가했다.
  test('에이전트 행을 키보드(Tab+Enter)로 상세 드로어를 열 수 있다 (#810)', { tag: '@input' }, async ({ adminPage: page }) => {
    await setupStatic(page);
    await page.goto('/settings/agents');
    const row = page.getByRole('button', { name: 'Claude 봇 상세 보기' });
    await expect(row).toBeVisible();

    await expect(page.getByTestId('agent-detail-drawer')).toHaveCount(0);
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('agent-detail-drawer')).toBeVisible();
  });
});
