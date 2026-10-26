// 설정 가이드(WP-399) 화면별 연결 — 화면 컴포넌트 테스트(WP-971, WP-995).
// 역할 상세·사용자 상세·프로젝트 설정(팀/개인)이 자기 가이드를 붙이는지, 역할·사용자 상세는 데이터가 오기 전(스켈레톤)에도 가이드를 여는지는
// 브라우저 없이 판정되므로 e2e/pages/settings/settings-guide.spec.ts 에서 옮겼다(AI 비서·SSO·알림은 각 화면 테스트 파일이 본다).
// jsdom 은 본문 폭이 0 이라 가이드가 늘 헤더 버튼(시트)이다 — 열/시트 전환·sticky 같은 폭 판정은 E2E(@layout)에 남는다.
// 가이드가 AI 에 넘기는 화면 맥락(WP-414 — 사용자 상세의 대상·username ref, 프로젝트 설정의 키·이름·종류)도
// settings-guide-ask-ai.spec.ts 에서 옮겼다(전송 body 에 싣는 일은 AIChatPanel 이, 팀 프로젝트 끝까지 배선은 그 E2E @wiring 이 본다).
// 화면 컴포넌트를 라우트 패턴(:id·:key)으로 감싸 renderScreen 으로 띄운다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { settingsGuides } from '@/components/settings-guide/settingsGuides'
import RoleDetailPage from '@/pages/admin/RoleDetailPage'
import UserDetailPage from '@/pages/admin/UserDetailPage'
import ProjectSettingsPage from '@/pages/projects/ProjectSettingsPage'
import { renderScreen } from '@/test/renderScreen'
import type { ProjectResponse } from '@/types/project'

import { createPermissions, createRoleDetail } from '../../../e2e/factories/admin.factory'
import { createRole, createUserDetail } from '../../../e2e/factories/auth.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'
import { seedStatuses } from '../../../e2e/factories/projectStatus.factory'
import { gate } from './memoryTestkit-b7'
import { openGuideSheet, screenContext, withAssistant } from './testkit-b7'

const ADMIN = { isAdmin: true, hasRole: (r: string) => r === 'ADMIN' }

/** 역할 상세 조회 — hold 를 주면 역할 GET 을 그동안 붙든다(스켈레톤 상태). */
const roleHandlers = (hold?: Promise<void>) => [
  http.get('/api/v1/roles/1', async () => {
    if (hold) await hold
    return HttpResponse.json(createRoleDetail({ id: 1, name: 'EDITOR', description: '편집자 역할', isSystem: false }))
  }),
  http.get('/api/v1/permissions', () => HttpResponse.json(createPermissions())),
]

/** 사용자 상세 조회 — hold 를 주면 사용자 GET 을 그동안 붙든다. */
const userHandlers = (hold?: Promise<void>) => [
  http.get('/api/v1/users/1', async () => {
    if (hold) await hold
    return HttpResponse.json(createUserDetail({ id: 1, name: '테스트 사용자', username: 'user1', email: 'user1@example.com' }))
  }),
  http.get('/api/v1/roles', () =>
    HttpResponse.json([
      createRole({ id: 1, name: 'USER', description: '일반 사용자', isSystem: true }),
      createRole({ id: 2, name: 'ADMIN', description: '시스템 관리자', isSystem: true }),
    ]),
  ),
]

/** 프로젝트 설정 조회(e2e mockProjectSettings 와 같은 목록) — project 로 팀/개인을 고른다. */
const projectHandlers = (project: ProjectResponse) => {
  const base = `/api/v1/projects/${project.key}`
  return [
    http.get(base, () => HttpResponse.json(project)),
    http.get(`${base}/members`, () => HttpResponse.json([createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })])),
    ...['labels', 'types', 'fields', 'cycles', 'milestones', 'components', 'versions', 'saved-views'].map((sub) =>
      http.get(`${base}/${sub}`, () => HttpResponse.json([])),
    ),
    http.get(`${base}/statuses`, () => HttpResponse.json(seedStatuses())),
    http.get(`${base}/issues/group-counts`, () => HttpResponse.json({ groupBy: 'statusId', groups: [] })),
    // 멤버 추가 후보(구성원 디렉터리)·공용 메모리 링크(팀 프로젝트)가 부르는 조회.
    http.get('/api/v1/members', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
    http.get('/api/v1/shared-ai-memories/spaces', () => HttpResponse.json({ items: [] })),
  ]
}

describe('화면별 가이드 내용', () => {
  test('역할 상세는 역할 상세 가이드를 붙인다', async () => {
    const { user } = renderScreen(withAssistant(<Routes><Route path="/settings/roles/:id" element={<RoleDetailPage />} /></Routes>), {
      path: '/settings/roles/1',
      auth: ADMIN,
      handlers: roleHandlers(),
    })
    await screen.findByRole('textbox', { name: '역할 이름' })
    expect((await openGuideSheet(user)).getByText(settingsGuides.roleDetail.lead)).toBeInTheDocument()
  })

  test('사용자 상세는 사용자 상세 가이드를 붙인다', async () => {
    const { user } = renderScreen(withAssistant(<Routes><Route path="/settings/users/:id" element={<UserDetailPage />} /></Routes>), {
      path: '/settings/users/1',
      auth: ADMIN,
      handlers: userHandlers(),
    })
    await screen.findByRole('heading', { name: '역할 할당' })
    expect((await openGuideSheet(user)).getByText(settingsGuides.userDetail.lead)).toBeInTheDocument()
    // AI 화면 맥락 — 대상(이름·역할·활성)과 username ref (WP-414).
    await waitFor(() => expect(screenContext()?.focus).toMatchObject({ type: '사용자', label: '테스트 사용자', refs: { username: 'user1' } }))
    const ctx = screenContext()!
    expect(ctx.view).toBe('설정 · 사용자 상세')
    expect(ctx.focus!.facts).toContainEqual({ label: '활성 상태', value: '활성' })
    expect(ctx.focus!.facts!.find((f) => f.label === '역할')).toBeTruthy()
  })

  test.each([
    ['팀 프로젝트', 'TEAM' as const, settingsGuides.projectSettings, settingsGuides.personalProjectSettings, '설정 · 프로젝트 설정', '팀'],
    ['개인 프로젝트(팀 가이드 아님)', 'PERSONAL' as const, settingsGuides.personalProjectSettings, settingsGuides.projectSettings, '설정 · 개인 프로젝트 설정', '개인'],
  ])('%s 설정은 자기 가이드와 화면 맥락(키·이름·종류)을 붙인다', async (_name, type, guide, absent, view, kind) => {
    const { user } = renderScreen(withAssistant(<Routes><Route path="/projects/:key/settings" element={<ProjectSettingsPage />} /></Routes>), {
      path: '/projects/WP/settings',
      handlers: projectHandlers(createProject({ type })),
    })
    await screen.findByRole('heading', { name: '기본 정보' })
    const sheet = await openGuideSheet(user)
    expect(sheet.getByText(guide.lead)).toBeInTheDocument()
    expect(sheet.queryByText(absent.lead)).not.toBeInTheDocument()
    await waitFor(() => expect(screenContext()?.focus).toMatchObject({ type: '프로젝트', label: 'Workplace', refs: { projectKey: 'WP' } }))
    const ctx = screenContext()!
    expect(ctx.view).toBe(view)
    expect(ctx.focus!.facts).toContainEqual({ label: '종류', value: kind })
  })
})

// 데이터가 오기 전(스켈레톤)에도 가이드를 열 수 있고, 데이터가 온 뒤에도 가이드가 남는다.
describe('로딩 중에도 가이드', () => {
  test('역할 상세: 역할 응답 전에도 가이드를 열 수 있고, 온 뒤에도 남는다', async () => {
    const held = gate()
    const { user } = renderScreen(withAssistant(<Routes><Route path="/settings/roles/:id" element={<RoleDetailPage />} /></Routes>), {
      path: '/settings/roles/1',
      auth: ADMIN,
      handlers: roleHandlers(held.p),
    })
    const sheet = await openGuideSheet(user)
    expect(sheet.getByText(settingsGuides.roleDetail.lead)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '역할 이름' })).not.toBeInTheDocument()
    held.release()
    expect(await screen.findByRole('textbox', { name: '역할 이름' })).toBeInTheDocument()
    expect(screen.getByText(settingsGuides.roleDetail.lead)).toBeInTheDocument()
  })

  test('사용자 상세: 사용자 응답 전에도 가이드를 열 수 있고, 온 뒤에도 남는다', async () => {
    const held = gate()
    const { user } = renderScreen(withAssistant(<Routes><Route path="/settings/users/:id" element={<UserDetailPage />} /></Routes>), {
      path: '/settings/users/1',
      auth: ADMIN,
      handlers: userHandlers(held.p),
    })
    const sheet = await openGuideSheet(user)
    expect(sheet.getByText(settingsGuides.userDetail.lead)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '역할 할당' })).not.toBeInTheDocument()
    held.release()
    expect(await screen.findByRole('heading', { name: '역할 할당' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(settingsGuides.userDetail.lead)).toBeInTheDocument())
  })
})
