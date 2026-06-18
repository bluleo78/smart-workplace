// /settings/users — '구분' 컬럼의 AGENT/HUMAN 시각 일관성 회귀 (#287).
// 같은 컬럼에서 AGENT 는 배지, HUMAN 은 옅은 텍스트로 표시되던 불일치를 수정 →
// HUMAN 도 Badge('일반') 로 통일됐는지 검증한다.

import type { Page } from '@playwright/test';

import { createUser } from '../../factories/auth.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { createPageResponse, mockApi } from '../../fixtures/api-mock';

// AGENT 1명 + HUMAN 1명을 한 목록에 섞어 두 행의 '구분' 렌더링을 비교한다.
const AGENT_USER = createUser({
  id: 10,
  name: '에이전트 봇',
  username: 'agent_bot',
  email: 'agent@example.com',
  kind: 'AGENT',
});
const HUMAN_USER = createUser({
  id: 11,
  name: '사람 사용자',
  username: 'human_user',
  email: 'human@example.com',
  kind: 'HUMAN',
});

async function setupPage(page: Page) {
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([AGENT_USER, HUMAN_USER]));
  await page.goto('/settings/users');
  // 행(tr)은 role="button" + aria-label="사용자 {이름} 상세 보기" 로 렌더된다.
  await expect(page.getByRole('button', { name: '사용자 사람 사용자 상세 보기' })).toBeVisible();
}

test.describe('UserListPage 구분 컬럼 일관성 (#287)', () => {
  test('AGENT 와 HUMAN 모두 배지로 표시된다', async ({ adminPage: page }) => {
    await setupPage(page);

    // AGENT 행: 기존 AgentBadge(아이콘 배지) 유지
    const agentRow = page.getByRole('button', { name: '사용자 에이전트 봇 상세 보기' });
    await expect(agentRow.getByTestId('agent-badge')).toBeVisible();

    // HUMAN 행: 옅은 텍스트가 아니라 '일반' Badge 로 통일됐는지 검증 (회귀 핵심)
    const humanRow = page.getByRole('button', { name: '사용자 사람 사용자 상세 보기' });
    const humanKindCell = humanRow.getByRole('cell').nth(3);
    await expect(humanKindCell.getByText('일반', { exact: true })).toBeVisible();

    // 수정 전의 'HUMAN' 옅은 텍스트는 더 이상 존재하지 않아야 한다
    await expect(humanRow.getByText('HUMAN', { exact: true })).toHaveCount(0);
  });
});
