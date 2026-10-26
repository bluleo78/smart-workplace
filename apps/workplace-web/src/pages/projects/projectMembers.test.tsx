// 개인 프로젝트 AI 어시스턴트 추가(#418) — 페이지 테스트(WP-980).
// 「AI 어시스턴트 추가」 → AGENT 후보 선택 → POST payload → 토스트·표 갱신은 브라우저 없이 판정되므로
// e2e/pages/projects/project-members.spec.ts 에서 옮겼다(그 spec 은 모두 옮겨 지웠다).
// 모드 분기(agentOnly 헤딩·탭 숨김·kind=AGENT 조회)는 MemberManagement.test.tsx·MemberSearchPopover.test.tsx 가 맡는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { projectSettingsHandlers } from '@/test/kits/projects/issueDetailStubs'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { MemberSummary } from '@/types/member'

import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'MY'
const summary = (userId: number, username: string, name: string, kind: 'HUMAN' | 'AGENT'): MemberSummary => ({
  userId, username, name, email: `${username}@workplace`, title: null, kind, active: true, membershipRole: 'MEMBER', membershipStatus: 'ACTIVE',
})
const AGENT_USER = summary(301, 'workplace-ai', 'Workplace AI', 'AGENT')
// 사람 후보 — agentOnly 모드에선 노출되지 않아야 한다.
const HUMAN_USER = summary(302, 'coworker', 'Coworker', 'HUMAN')

test('개인 프로젝트 설정 → AI 어시스턴트 추가 → POST {userId, role: MEMBER} + 토스트 + 표 반영', async () => {
  const members: unknown[] = [{ userId: 1, username: 'me', name: 'Me', kind: 'HUMAN', role: 'OWNER', createdAt: null }]
  const posts: unknown[] = []
  const project = createProject({ id: 10, key: KEY, name: '내 프로젝트', type: 'PERSONAL', isDefault: false })
  const { user } = renderPage(`/projects/${KEY}/settings`, {
    handlers: [
      http.get('/api/v1/members', ({ request }) => {
        const url = new URL(request.url)
        const q = url.searchParams.get('search') ?? ''
        const kind = url.searchParams.get('kind') ?? 'HUMAN'
        const matched = [AGENT_USER, HUMAN_USER]
          .filter((u) => kind === 'ALL' || u.kind === kind)
          .filter((u) => q.trim().length < 1 || u.username.includes(q) || u.name.toLowerCase().includes(q.toLowerCase()))
        return HttpResponse.json({ content: matched, page: 0, size: 20, totalElements: matched.length, totalPages: 1 })
      }),
      http.post(`/api/v1/projects/${KEY}/members`, async ({ request }) => {
        posts.push(await request.json())
        members.push({ userId: AGENT_USER.userId, username: AGENT_USER.username, name: AGENT_USER.name, kind: 'AGENT', role: 'MEMBER', createdAt: '2026-01-01T00:00:00Z' })
        return HttpResponse.json({}, { status: 201 })
      }),
      ...projectSettingsHandlers(project, () => members),
    ],
  })
  const addBtn = await screen.findByTestId('member-add-trigger', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(addBtn).toHaveTextContent('AI 어시스턴트 추가')
  await user.click(addBtn)
  const popover = await screen.findByTestId('member-search-popover')
  await user.click(within(popover).getByPlaceholderText('이름·아이디·이메일로 검색'))
  await user.paste('workplace')
  const row = await within(popover).findByTestId(`member-search-row-${AGENT_USER.userId}`)
  expect(within(popover).queryByTestId(`member-search-row-${HUMAN_USER.userId}`)).not.toBeInTheDocument()
  await user.click(row)
  await waitFor(() => expect(posts).toEqual([{ userId: AGENT_USER.userId, role: 'MEMBER' }]))
  expect(await screen.findByText(`${AGENT_USER.name} 을(를) 추가했습니다`)).toBeInTheDocument()
  expect(await screen.findByRole('row', { name: /Workplace AI/ })).toBeInTheDocument()
})
