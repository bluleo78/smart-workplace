// AGENT 가 쓴 코멘트·이력의 시각 구분(Phase 5c-3, #301·#311) — 페이지 테스트(WP-980).
// 응답의 authorKind/actorKind → data-agent 속성·AI 배지·ai-accent 시맨틱 토큰 클래스는 브라우저 없이 판정되므로
// e2e/pages/projects/agent-visual.spec.ts 에서 옮겼다(그 spec 은 모두 옮겨 지웠다).
import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import { openIssueDetail } from '@/test/kits/projects/openIssueDetail'

import {
  createAgentComment,
  createAgentHistoryEntry,
  createComment,
  createHistoryEntry,
  createIssue,
  createIssueDetail,
} from '../../../e2e/factories/issue.factory'

test('AGENT 코멘트는 USER 와 시각적으로 구분된다 — data-agent·AI 배지·ai-accent 토큰(#301)', async () => {
  await openIssueDetail({
    detail: createIssueDetail({
      summary: createIssue(),
      comments: [
        createComment({ id: 1, authorName: 'Alice', body: '사람 코멘트' }),
        createAgentComment({ id: 2, authorName: 'AI Agent', body: 'AI 코멘트' }),
      ],
    }),
  })
  const userItem = (await screen.findByText('사람 코멘트')).closest('li')!
  expect(userItem).not.toHaveAttribute('data-agent', 'true')
  expect(within(userItem).queryByText('AI', { exact: true })).not.toBeInTheDocument()

  const agentItem = screen.getByText('AI 코멘트').closest('li')!
  expect(agentItem).toHaveAttribute('data-agent', 'true')
  // 시맨틱 토큰 회귀 — raw 팔레트(border-blue-500·bg-blue-100)로 되돌아가면 실패한다.
  expect(agentItem.className).toMatch(/border-ai-accent/)
  expect(agentItem.className).not.toMatch(/border-blue-500/)
  const badge = within(agentItem).getByText('AI', { exact: true })
  // 배지는 AI 변형(WP-1034 — AI 옅은 색 머리 띠 위에서도 테두리로 모양이 보인다).
  expect(badge).toHaveAttribute('data-variant', 'ai')
  expect(badge).toHaveClass('text-ai-accent')
  expect(badge.className).not.toMatch(/bg-blue-100/)
})

test('AGENT 가 일으킨 이력은 시각적으로 구분되고, HUMAN 행도 보더가 보인다(#311)', async () => {
  const { user } = await openIssueDetail({
    detail: createIssueDetail({
      summary: createIssue({ status: 'IN_PROGRESS' }),
      history: [
        createHistoryEntry({ id: 1, actorName: 'Alice', fromValue: 'TODO', toValue: 'IN_PROGRESS' }),
        createAgentHistoryEntry({ id: 2, actorName: 'AI Agent', fromValue: 'IN_PROGRESS', toValue: 'DONE' }),
      ],
    }),
  })
  // 활동은 「이력」 탭 안에 있다(#343).
  await user.click(screen.getByRole('tab', { name: /이력/ }))
  const timeline = await screen.findByRole('list', { name: '활동 타임라인' })
  const rows = within(timeline).getAllByRole('listitem')
  const userRow = rows.find((li) => li.textContent?.includes('Alice'))!
  expect(userRow).not.toHaveAttribute('data-agent', 'true')
  expect(userRow).toHaveClass('border-l-border')

  const agentRow = rows.find((li) => li.getAttribute('data-agent') === 'true' && li.textContent?.includes('AI Agent'))!
  expect(agentRow.className).toMatch(/border-l-ai-accent/)
  expect(agentRow.className).not.toMatch(/border-l-blue-500/)
  const badge = within(agentRow).getByText('AI', { exact: true })
  expect(badge).toHaveClass('bg-ai-accent-subtle', 'text-ai-accent')
  expect(badge.className).not.toMatch(/bg-blue-100/)
})
