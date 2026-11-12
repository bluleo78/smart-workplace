// 설정 › 역할 상세·사용자 상세(RoleDetailPage·UserDetailPage) — 매뉴얼 14장 도움말 연결 테스트(WP-1508).
// 칸·확인창이 맞는 도움말 절로 이어지는지, 화면 참고(AI)에 「설정 · 역할 상세/사용자 상세」와 매뉴얼 설명이 실리는지,
// 응답 전(스켈레톤)에도 화면 이름이 실리는지를 본다. settingsGuideScreens.test.tsx 의 역할·사용자 부분에서 옮겼다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'

import { currentScreenContext, withScreenContextProbe } from '@/test/kits/ai/ScreenContextProbe'
import { gate } from '@/test/kits/ai/testkit-b2a'
import { expectHelpTarget } from '@/test/kits/help/expectHelpTarget'
import { helpBundleHandlers } from '@/test/kits/help/helpBundleKit'
import { atRoute } from '@/test/kits/projects/atRoute'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'

import { createPermissions, createRoleDetail } from '../../../e2e/factories/admin.factory'
import { createRole, createUserDetail } from '../../../e2e/factories/auth.factory'
import RoleDetailPage from './RoleDetailPage'
import UserDetailPage from './UserDetailPage'

const ADMIN = { isAdmin: true, hasRole: (r: string) => r === 'ADMIN' }

/** 역할 상세 조회 — hold 를 주면 역할 GET 을 그동안 붙든다(스켈레톤 상태). isSystem 으로 시스템 역할을 고른다. */
const roleHandlers = (hold?: Promise<void>, isSystem = false) => [
  http.get('/api/v1/roles/1', async () => {
    if (hold) await hold
    return HttpResponse.json(createRoleDetail({ id: 1, name: 'EDITOR', description: '편집자 역할', isSystem }))
  }),
  http.get('/api/v1/permissions', () => HttpResponse.json(createPermissions())),
]

/** 사용자 상세 조회 — hold 를 주면 사용자 GET 을 그동안 붙든다. 테스트 로그인 계정이 id 1 이라 그 계정은 스위치가 잠긴다(WP-909) — 끄기 확인창은 userId 로 다른 사람을 연다. */
const userHandlers = (hold?: Promise<void>, userId = 1) => [
  http.get(`/api/v1/users/${userId}`, async () => {
    if (hold) await hold
    return HttpResponse.json(createUserDetail({ id: userId, name: '테스트 사용자', username: 'user1', email: 'user1@example.com' }))
  }),
  http.get('/api/v1/roles', () =>
    HttpResponse.json([
      createRole({ id: 1, name: 'USER', description: '일반 사용자', isSystem: true }),
      createRole({ id: 2, name: 'ADMIN', description: '시스템 관리자', isSystem: true }),
    ]),
  ),
]

const roleScreen = (el: React.ReactElement) => atRoute('/settings/roles/:id', el)
const userScreen = (el: React.ReactElement) => atRoute('/settings/users/:id', el)

beforeEach(() => {
  server.use(...helpBundleHandlers(), ...shellHandlers)
})

describe('도움말 절 연결', () => {
  test('역할 상세 — 칸이 맞는 도움말 절로 이어진다', async () => {
    renderScreen(roleScreen(<RoleDetailPage />), { path: '/settings/roles/1', auth: ADMIN, handlers: roleHandlers(undefined, true) })
    const name = await screen.findByRole('textbox', { name: '역할 이름' })
    expectHelpTarget(screen.getByText('시스템 역할은 이름·설명·권한을 수정할 수 없습니다.'), 'role.system')
    expectHelpTarget(screen.getByRole('heading', { level: 2, name: '역할 정보' }), 'role.info')
    expectHelpTarget(name, 'role.info')
    expectHelpTarget(screen.getByRole('heading', { level: 2, name: '권한 할당' }), 'role.permissions')
  })

  test('사용자 상세 — 칸과 비활성화 확인창이 맞는 도움말 절로 이어진다', async () => {
    const { user } = renderScreen(userScreen(<UserDetailPage />), { path: '/settings/users/2', auth: ADMIN, handlers: userHandlers(undefined, 2) })
    expectHelpTarget(await screen.findByRole('heading', { level: 2, name: '기본 정보' }), 'user.info')
    expectHelpTarget(screen.getByRole('heading', { level: 2, name: '활성 상태' }), 'user.active')
    expectHelpTarget(screen.getByRole('heading', { level: 2, name: '역할 할당' }), 'user.roles')
    await user.click(screen.getByRole('switch', { name: '활성 상태' }))
    expectHelpTarget(await screen.findByRole('alertdialog'), 'user.active')
  })
})

// 설정 가이드 대신 매뉴얼 대표 절·하위 절 요약이 AI 화면 참고에 실린다.
describe('화면 참고', () => {
  test('역할 상세 — 화면 이름과 매뉴얼 설명이 실린다', async () => {
    renderScreen(roleScreen(withScreenContextProbe(<RoleDetailPage />)), { path: '/settings/roles/1', auth: ADMIN, handlers: roleHandlers() })
    await screen.findByRole('textbox', { name: '역할 이름' })
    await waitFor(() => expect(currentScreenContext()?.scope?.facts).toContainEqual({ label: '소개', value: '역할 상세 본문.' }))
    const ctx = currentScreenContext()!
    expect(ctx.view).toBe('설정 · 역할 상세')
    expect(ctx.scope!.facts).toContainEqual({ label: '권한 할당', value: '권한 본문.' })
    expect(ctx.focus).toMatchObject({ type: '역할', label: 'EDITOR' })
  })

  test('사용자 상세 — 화면 이름과 매뉴얼 설명·대상이 실린다', async () => {
    renderScreen(userScreen(withScreenContextProbe(<UserDetailPage />)), { path: '/settings/users/1', auth: ADMIN, handlers: userHandlers() })
    await screen.findByRole('heading', { level: 2, name: '역할 할당' })
    await waitFor(() => expect(currentScreenContext()?.scope?.facts).toContainEqual({ label: '소개', value: '사용자 상세 본문.' }))
    const ctx = currentScreenContext()!
    expect(ctx.view).toBe('설정 · 사용자 상세')
    expect(ctx.scope!.facts).toContainEqual({ label: '활성 상태', value: '활성 상태 본문.' })
    // AI 화면 맥락 — 대상(이름·역할·활성)과 username ref (WP-414).
    await waitFor(() => expect(currentScreenContext()?.focus).toMatchObject({ type: '사용자', label: '테스트 사용자', refs: { username: 'user1' } }))
    expect(currentScreenContext()!.focus!.facts).toContainEqual({ label: '활성 상태', value: '활성' })
    expect(currentScreenContext()!.focus!.facts!.find((f) => f.label === '역할')).toBeTruthy()
  })
})

// 응답 전(스켈레톤)에도 화면 이름이 실리고, 응답이 온 뒤에도 남는다.
describe('로딩 중', () => {
  test.each([
    ['역할 상세', '설정 · 역할 상세', '/settings/roles/1', roleScreen, <RoleDetailPage />, roleHandlers, { name: '역할 이름' } as { level?: 2; name: string }],
    ['사용자 상세', '설정 · 사용자 상세', '/settings/users/1', userScreen, <UserDetailPage />, userHandlers, { level: 2 as const, name: '역할 할당' }],
  ])('%s — 응답 전(스켈레톤)에도 화면 이름이 실린다', async (_n, view, path, wrap, page, handlers, field) => {
    const held = gate()
    renderScreen(wrap(withScreenContextProbe(page)), { path, auth: ADMIN, handlers: handlers(held.p) })
    await waitFor(() => expect(currentScreenContext()?.view).toBe(view))
    expect(screen.queryByRole(field.level ? 'heading' : 'textbox', field)).not.toBeInTheDocument()
    held.release()
    expect(await screen.findByRole(field.level ? 'heading' : 'textbox', field)).toBeInTheDocument()
    expect(currentScreenContext()?.view).toBe(view)
  })
})
