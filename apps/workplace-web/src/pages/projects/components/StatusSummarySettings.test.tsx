// 프로젝트 설정 「리포트」(WP-1479) — 「상태 요약 간격」을 고르면 PATCH { statusSummaryInterval }, 소유자·관리자가 아니면 바꿀 수 없음,
// 개인 프로젝트 설정에는 섹션이 없음.
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { StatusSummarySettings } from '@/pages/projects/components/StatusSummarySettings'
import ProjectSettingsPage from '@/pages/projects/ProjectSettingsPage'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { ProjectResponse } from '@/types/project'

import { createMember, createProject } from '../../../../e2e/factories/project.factory'

const KEY = 'WP'

/** 섹션을 띄운다 — PATCH 본문을 모아 돌려준다. */
function open(project: ProjectResponse, canManage = true) {
  const bodies: unknown[] = []
  const view = renderScreen(<StatusSummarySettings project={project} canManage={canManage} />, {
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

const combo = () => screen.getByRole('combobox', { name: '상태 요약 간격' })

/** 선택 상자를 열어 보기 이름을 읽는다. */
async function optionNames(user: UserEvent) {
  combo().focus()
  await user.keyboard('{Enter}')
  return (await screen.findAllByRole('option')).map((o) => o.textContent)
}

test('지금 간격(기본 2시간)을 보이고, 4시간을 고르면 statusSummaryInterval H4 를 PATCH 한다', async () => {
  const { user, bodies } = open(createProject({ statusSummaryInterval: 'H2' }))
  expect(screen.getByText('리포트')).toBeInTheDocument()
  expect(combo()).toHaveTextContent('2시간')
  expect(await optionNames(user)).toEqual(['1시간', '2시간', '4시간', '하루 한 번'])
  const h4 = screen.getByRole('option', { name: '4시간' })
  h4.focus()
  await user.keyboard('{Enter}')

  await waitFor(() => expect(bodies).toEqual([{ statusSummaryInterval: 'H4' }]))
  expect(await screen.findByText('상태 요약 간격을 4시간으로 바꿨어요')).toBeInTheDocument()
  expect(combo()).toHaveTextContent('4시간')
})

test('값이 없는 응답(구버전 서버)은 기본 2시간으로 보인다', () => {
  open(createProject({ statusSummaryInterval: undefined }))
  expect(combo()).toHaveTextContent('2시간')
})

test('소유자·관리자가 아니면 선택 상자가 비활성이고 요청이 없다', async () => {
  const { user, bodies } = open(createProject({ statusSummaryInterval: 'DAILY' }), false)
  expect(combo()).toBeDisabled()
  expect(combo()).toHaveTextContent('하루 한 번')
  await user.click(combo())
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  expect(bodies).toEqual([])
})

/** 설정 화면(ProjectSettingsPage) 전체 — 섹션을 그릴지(개인 프로젝트 제외)는 화면이 정한다. */
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

test('팀 프로젝트 설정에는 「리포트」 섹션이 있고, 개인 프로젝트에는 없다', async () => {
  const team = renderSettings(createProject({ type: 'TEAM' }))
  expect(await screen.findByRole('combobox', { name: '상태 요약 간격' })).toBeInTheDocument()
  // 주간 리포트 줄(WP-1483)은 같은 「리포트」 섹션 안, 상태 요약 줄 아래에 있고 상태 요약은 리포트와 별개라고 알린다.
  const section = screen.getByTestId('project-report-settings')
  expect(within(section).getByText(/리포트와 별개, 개요 카드 전용/)).toBeInTheDocument()
  expect(await within(section).findByRole('switch', { name: '주간 리포트' })).toBeInTheDocument()
  team.unmount()

  renderSettings(createProject({ type: 'PERSONAL' }))
  expect(await screen.findByRole('heading', { name: '프로젝트 설정' })).toBeInTheDocument()
  expect(await screen.findByText('연결된 저장소')).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: '상태 요약 간격' })).not.toBeInTheDocument()
  expect(screen.queryByText('리포트')).not.toBeInTheDocument()
})
