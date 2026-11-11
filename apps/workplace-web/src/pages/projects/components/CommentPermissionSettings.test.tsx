// 프로젝트 설정 「댓글」(WP-1495) — 접수함(OPEN) 프로젝트에서 비멤버 댓글 허용 토글, 그리고 권한이 없을 때 댓글 입력 대신 안내.
import { screen, waitFor } from '@testing-library/react'
import type { RequestHandler } from 'msw'
import { delay, http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { CommentPermissionSettings } from '@/pages/projects/components/CommentPermissionSettings'
import { IssueCommentList } from '@/pages/projects/components/IssueCommentList'
import ProjectSettingsPage from '@/pages/projects/ProjectSettingsPage'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { ProjectResponse } from '@/types/project'

import { createMember, createProject } from '../../../../e2e/factories/project.factory'

const KEY = 'WP'

/** 섹션을 띄운다 — PATCH 본문을 모아 돌려준다. */
function open(project: ProjectResponse, canManage = true) {
  const bodies: unknown[] = []
  const view = renderScreen(<CommentPermissionSettings project={project} canManage={canManage} />, {
    path: `/projects/${KEY}/settings`,
    handlers: [
      http.patch(`/api/v1/projects/${KEY}`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return HttpResponse.json({ ...project, ...body })
      }),
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(project)),
    ],
  })
  return { ...view, bodies }
}

test('OPEN 소유자가 토글을 켜면 nonMemberComment true 를 PATCH 하고 토스트를 띄운다', async () => {
  const { user, bodies } = open(createProject({ type: 'OPEN', nonMemberComment: false }))
  const sw = screen.getByRole('switch', { name: '멤버가 아니어도 댓글 달기' })
  expect(sw).not.toBeChecked()
  await user.click(sw)

  expect(await screen.findByText('멤버가 아니어도 댓글을 달 수 있어요')).toBeInTheDocument()
  expect(bodies).toEqual([{ nonMemberComment: true }])
})

test('켜진 값으로 열면 토글이 켜져 있고, 끄면 false 를 보낸다', async () => {
  const { user, bodies } = open(createProject({ type: 'OPEN', nonMemberComment: true }))
  const sw = screen.getByRole('switch', { name: '멤버가 아니어도 댓글 달기' })
  expect(sw).toBeChecked()
  await user.click(sw)

  expect(await screen.findByText('멤버만 댓글을 달 수 있어요')).toBeInTheDocument()
  expect(bodies).toEqual([{ nonMemberComment: false }])
})

test('소유자가 아니면 토글이 비활성이고 눌러도 요청이 없다', async () => {
  const { user, bodies } = open(createProject({ type: 'OPEN', nonMemberComment: false }), false)
  const sw = screen.getByRole('switch', { name: '멤버가 아니어도 댓글 달기' })
  expect(sw).toBeDisabled()
  await user.click(sw)
  expect(bodies).toEqual([])
})

/** 설정 화면(ProjectSettingsPage) 전체 — 섹션을 그릴지(OPEN 만)는 화면이 정한다. */
function renderSettings(project: ProjectResponse) {
  const base = `/api/v1/projects/${project.key}`
  const handlers: RequestHandler[] = [
    http.get(base, () => HttpResponse.json(project)),
    http.get(`${base}/members`, () => HttpResponse.json([createMember({ userId: 1 })])),
    http.get(`${base}/member-groups`, () => HttpResponse.json([])),
    http.get(`${base}/fields`, () => HttpResponse.json([])),
    http.get(`${base}/issues/group-counts`, () => HttpResponse.json({ groupBy: 'statusId', groups: [] })),
    http.get('/api/v1/shared-ai-memories/spaces', () => HttpResponse.json({ items: [] })),
    ...shellHandlers,
  ]
  return renderScreen(
    <Routes>
      <Route path="/projects/:key/settings" element={<ProjectSettingsPage />} />
    </Routes>,
    { path: `/projects/${project.key}/settings`, handlers },
  )
}

test('OPEN 프로젝트 설정에는 댓글 섹션이 있고, TEAM 프로젝트에는 없다', async () => {
  const openView = renderSettings(createProject({ type: 'OPEN' }))
  expect(await screen.findByText('멤버가 아니어도 댓글 달기')).toBeInTheDocument()
  openView.unmount()

  renderSettings(createProject({ type: 'TEAM' }))
  expect(await screen.findByRole('heading', { name: '프로젝트 설정' })).toBeInTheDocument()
  expect(await screen.findByText('연결된 저장소')).toBeInTheDocument()
  expect(screen.queryByText('멤버가 아니어도 댓글 달기')).not.toBeInTheDocument()
})

test('댓글 입력을 잠그면 입력 대신 안내를 보이고, 아니면 입력을 보인다', async () => {
  const locked = renderScreen(
    <IssueCommentList projectKey="WP" issueNumber={1} issueId={100} comments={[]} canReact={false} commentLocked />,
    { handlers: [...shellHandlers] },
  )
  expect(screen.getByText('이 프로젝트 멤버만 댓글을 달 수 있어요')).toBeInTheDocument()
  expect(screen.queryByLabelText('코멘트 작성')).not.toBeInTheDocument()
  locked.unmount()

  renderScreen(<IssueCommentList projectKey="WP" issueNumber={1} issueId={100} comments={[]} canReact={false} />, { handlers: [...shellHandlers] })
  expect(await screen.findByLabelText('코멘트 작성')).toBeInTheDocument()
  expect(screen.queryByText('이 프로젝트 멤버만 댓글을 달 수 있어요')).not.toBeInTheDocument()
})

// 저장 직후 재조회가 아직 옛 값을 줘도 스위치는 방금 고른 값으로 보인다(깜빡임 방지).
test('토글을 누른 뒤 재조회가 옛 값을 줘도 스위치는 새 값으로 보인다', async () => {
  const project = createProject({ type: 'OPEN', nonMemberComment: false })
  const view = renderScreen(<CommentPermissionSettings project={project} canManage />, {
    path: `/projects/${KEY}/settings`,
    handlers: [
      http.patch(`/api/v1/projects/${KEY}`, () => HttpResponse.json({ ...project, nonMemberComment: true })),
      // 재조회는 늦게, 옛 값으로 돌려준다
      http.get(`/api/v1/projects/${KEY}`, async () => {
        await delay(300)
        return HttpResponse.json(project)
      }),
    ],
  })
  const sw = screen.getByRole('switch', { name: '멤버가 아니어도 댓글 달기' })
  await view.user.click(sw)
  expect(await screen.findByText('멤버가 아니어도 댓글을 달 수 있어요')).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: '멤버가 아니어도 댓글 달기' })).toBeChecked()
})

test('저장이 실패하면 스위치가 원래 값으로 돌아온다', async () => {
  const project = createProject({ type: 'OPEN', nonMemberComment: false })
  const view = renderScreen(<CommentPermissionSettings project={project} canManage />, {
    path: `/projects/${KEY}/settings`,
    handlers: [
      http.patch(`/api/v1/projects/${KEY}`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(project)),
    ],
  })
  await view.user.click(screen.getByRole('switch', { name: '멤버가 아니어도 댓글 달기' }))
  await waitFor(() => expect(screen.getByRole('switch', { name: '멤버가 아니어도 댓글 달기' })).not.toBeChecked())
})
