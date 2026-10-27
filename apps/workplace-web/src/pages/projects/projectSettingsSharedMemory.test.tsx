// 프로젝트 설정의 「공용 AI 메모리 n개 · 관리」 링크(WP-386) — 화면 테스트(WP-971, WP-1002 에서 설정 화면만 띄우게 바꿈).
// 개인 프로젝트에는 링크가 없다는 조건부 렌더는 브라우저 없이 판정되므로
// e2e/pages/projects/project-settings-shared-memory.spec.ts 에서 옮겼다. 링크 → AI 비서 설정으로 가는 흐름(@flow)과
// 공간 목록을 받는 동안 자리를 잡아 아래 섹션이 밀리지 않는지(@layout)는 E2E 에 남는다.
import { screen } from '@testing-library/react'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import ProjectSettingsPage from '@/pages/projects/ProjectSettingsPage'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { SharedMemorySpace } from '@/types/sharedAiMemory'

import { createMember, createProject } from '../../../e2e/factories/project.factory'

/** WP 프로젝트(id 12) 공용 메모리 공간 — e2e/fixtures/shared-memory-mock 의 sharedSpace 와 같은 기본값(그 파일은 Playwright 를 불러 여기서 못 쓴다). */
const space = (count: number, id: number): SharedMemorySpace => ({
  type: 'PROJECT', id, key: 'WP', name: 'Smart Workplace', label: 'Smart Workplace(WP)', count, limit: 50, canAdd: true, canManage: false,
})

/** 프로젝트 설정 화면 — 프로젝트·멤버·필드·상태별 이슈 수(빈 묶음)·공용 메모리 공간 목록(그 프로젝트의 공간이 늘 들어 있다). */
function settingsHandlers(project: ReturnType<typeof createProject>, count: number, served = { spaces: 0 }) {
  const base = `/api/v1/projects/${project.key}`
  return [
    http.get(base, () => HttpResponse.json(project)),
    http.get(`${base}/members`, () => HttpResponse.json([createMember({ userId: 1 })])),
    http.get(`${base}/fields`, () => HttpResponse.json([])),
    http.get(`${base}/issues/group-counts`, () => HttpResponse.json({ groupBy: 'statusId', groups: [] })),
    http.get('/api/v1/shared-ai-memories/spaces', () => {
      served.spaces++
      return HttpResponse.json({ items: [space(count, project.id)] })
    }),
  ]
}

/** 설정 화면(ProjectSettingsPage)만 띄운다 — 링크를 그릴지(개인 프로젝트 제외)는 화면이 정한다. 섹션들의 부가 조회는 셸 기본값이 받는다. */
const renderSettings = (path: string, handlers: RequestHandler[]) =>
  renderScreen(
    <Routes>
      <Route path="/projects/:key/settings" element={<ProjectSettingsPage />} />
    </Routes>,
    { path, handlers: [...handlers, ...shellHandlers] },
  )

test('팀 프로젝트 설정에는 공용 메모리 개수 링크가 그 공간을 고른 AI 비서 설정 주소로 걸린다', async () => {
  renderSettings('/projects/WP/settings', settingsHandlers(createProject({ id: 12, key: 'WP', type: 'TEAM' }), 3))
  const link = await screen.findByTestId('shared-memory-link')
  expect(link).toHaveTextContent(/공용 AI 메모리 3개\s*·\s*관리/)
  expect(link.closest('a') ?? link).toHaveAttribute('href', expect.stringContaining('/settings/assistant?memoryTab=shared&space=PROJECT%3A12'))
})

// 공간 목록에 같은 id 의 공간이 있어도 개인 프로젝트면 숨긴다 — 목록에 없어서 숨은 것과 구분되게 공간을 준다.
test('개인 프로젝트 설정에는 공용 메모리 링크가 없다', async () => {
  const served = { spaces: 0 }
  renderSettings('/projects/PABC/settings', settingsHandlers(createProject({ id: 30, key: 'PABC', type: 'PERSONAL' }), 0, served))
  expect(await screen.findByRole('heading', { name: '프로젝트 설정' })).toBeInTheDocument()
  // 섹션이 붙으면 공간 목록을 받는 동안에도 자리(pending)부터 보이므로, 링크와 자리 둘 다 없고 목록을 묻지도 않아야 한다.
  // 응답이 닿을 시간을 잠깐 둔 뒤 본다.
  await new Promise((r) => setTimeout(r, 200))
  expect(served.spaces).toBe(0)
  expect(screen.queryByTestId('shared-memory-link')).not.toBeInTheDocument()
  expect(screen.queryByTestId('shared-memory-link-pending')).not.toBeInTheDocument()
})
