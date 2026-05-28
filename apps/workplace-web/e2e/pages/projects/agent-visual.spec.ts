// Phase 5c-3: AGENT 가 작성한 코멘트와 활동 이력이 USER 와 시각적으로 구분되는지 검증.
// 데이터 파이프라인 검증: factory(authorKind/actorKind) → mock 응답 → UI data-agent 속성 + AI 배지.

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createProject } from '../../factories/project.factory';
import {
  createAgentComment,
  createAgentHistoryEntry,
  createComment,
  createHistoryEntry,
  createIssue,
  createIssueDetail,
} from '../../factories/issue.factory';

// non-smoke: 코멘트 리스트에서 AGENT 코멘트가 시각적으로 구분된다.
test('AGENT 코멘트는 USER 와 시각적으로 구분된다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject());
  await mockApi(
    page,
    'GET',
    '/api/v1/projects/WP/issues/1',
    createIssueDetail({
      summary: createIssue(),
      comments: [
        createComment({ id: 1, authorName: 'Alice', body: '사람 코멘트' }),
        createAgentComment({ id: 2, authorName: 'AI Agent', body: 'AI 코멘트' }),
      ],
    }),
  );

  await page.goto('/projects/WP/issues/1');

  // USER 코멘트: data-agent 속성 없음
  const userItem = page.locator('li').filter({ hasText: '사람 코멘트' });
  await expect(userItem).toBeVisible();
  await expect(userItem).not.toHaveAttribute('data-agent', 'true');
  await expect(userItem.getByText('AI', { exact: true })).toHaveCount(0);

  // AGENT 코멘트: data-agent="true" + 본문 + AI 배지
  const agentItem = page.locator('li[data-agent="true"]').filter({ hasText: 'AI 코멘트' });
  await expect(agentItem).toBeVisible();
  await expect(agentItem.getByText('AI 코멘트')).toBeVisible();
  await expect(agentItem.getByText('AI', { exact: true })).toBeVisible();
});

// non-smoke: 활동 타임라인에서 AGENT 행이 시각적으로 구분된다.
test('AGENT 가 일으킨 이력은 시각적으로 구분된다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject());
  await mockApi(
    page,
    'GET',
    '/api/v1/projects/WP/issues/1',
    createIssueDetail({
      summary: createIssue({ status: 'IN_PROGRESS' }),
      history: [
        createHistoryEntry({
          id: 1,
          actorName: 'Alice',
          fromValue: 'TODO',
          toValue: 'IN_PROGRESS',
        }),
        createAgentHistoryEntry({
          id: 2,
          actorName: 'AI Agent',
          fromValue: 'IN_PROGRESS',
          toValue: 'DONE',
        }),
      ],
    }),
  );

  await page.goto('/projects/WP/issues/1');

  const timeline = page.getByRole('list', { name: '활동 타임라인' });
  await expect(timeline).toBeVisible();

  const userRow = timeline.locator('li').filter({ hasText: 'Alice' });
  await expect(userRow).toBeVisible();
  await expect(userRow).not.toHaveAttribute('data-agent', 'true');

  const agentRow = timeline.locator('li[data-agent="true"]').filter({ hasText: 'AI Agent' });
  await expect(agentRow).toBeVisible();
  await expect(agentRow.getByText('AI', { exact: true })).toBeVisible();
});
