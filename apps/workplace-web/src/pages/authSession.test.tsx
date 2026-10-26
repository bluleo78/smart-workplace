// 세션 경계(로그아웃·다시 로그인)와 앱 셸 진입 페이지 테스트(WP-971).
// 로그아웃 뒤 저장값·화면 캐시 정리, 알림 탭 대기 목적지 소비, 앱 레일 순서는 브라우저 없이 판정되므로 아래 E2E 에서 옮겼다:
//   e2e/pages/auth.spec.ts(초안 정리·WP-700 캐시)·e2e/pages/pwa/push-open.spec.ts(대기 목적지)·e2e/pages/layout/app-rail-order.spec.ts(전부)
// renderPage 를 쓰는 이유: 앱 레일의 사용자 메뉴(앱 셸)로 로그아웃하고, 로그인 화면 → 다른 화면으로 넘나들며 그 화면 내용을 보며,
// 대기 목적지는 앱 셸(AppLayout)이 진입할 때 소비한다 — 모두 App·AuthProvider 전체가 있어야 한다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test } from 'vitest'

import { PENDING_PUSH_TARGET_KEY } from '@/lib/push/openTarget'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createLoginResponse, createUser } from '../../e2e/factories/auth.factory'
import { createProject } from '../../e2e/factories/project.factory'

const API = '/api/v1'
const pageOf = <T,>(content: T[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 })

afterEach(() => {
  window.sessionStorage.clear()
})

/** 레일 하단 사용자 메뉴로 로그아웃하고 로그인 화면에 닿을 때까지 기다린다. */
async function logoutViaRail(view: ReturnType<typeof renderPage>) {
  await view.user.click(await screen.findByRole('button', { name: '사용자 메뉴' }, { timeout: PAGE_LOAD_TIMEOUT }))
  await view.user.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
  await waitFor(() => expect(view.location()).toBe('/login'))
}

const loginPageHandlers = [
  http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${API}/auth/signup-available`, () => HttpResponse.json({ available: true })),
  http.get(`${API}/auth/sso/status`, () => HttpResponse.json({ m365: false })),
]

// WP-699 — 저장 안 한 이슈 본문 초안이 같은 기기의 다음 사용자에게 남지 않아야 한다. 다른 저장값은 건드리지 않는다.
test('로그아웃하면 이슈 본문 초안(옛 키 포함)이 지워지고 다른 저장값은 남는다', async () => {
  window.localStorage.setItem('issue-body-draft:1:-:WP:1', '저장 안 한 글')
  window.localStorage.setItem('issue-body-draft:WP:2', '예전 키 초안')
  window.localStorage.setItem('theme', 'dark')
  const view = renderPage('/', { handlers: loginPageHandlers })
  await logoutViaRail(view)
  expect(Object.keys(window.localStorage).filter((k) => k.startsWith('issue-body-draft:'))).toEqual([])
  expect(window.localStorage.getItem('theme')).toBe('dark')
})

// WP-700 — 로그아웃 뒤 같은 탭(새로고침 없음)에서 다른 사람이 로그인하면, 캐시 유지 시간 동안 앞 사용자의 프로젝트 목록이 그대로 그려졌다.
test('로그아웃 후 다른 사람이 로그인하면 앞 사용자의 프로젝트 목록이 보이지 않는다', async () => {
  let who: 'admin' | 'bob' = 'admin'
  const hr = createProject({ id: 11, key: 'HR', name: '관리자전용 인사평가' })
  const bobs = createProject({ id: 12, key: 'BOB', name: '밥의 개인 작업', type: 'PERSONAL' })
  const view = renderPage('/projects', {
    handlers: [
      ...loginPageHandlers,
      http.get(`${API}/projects`, () => HttpResponse.json(pageOf(who === 'admin' ? [hr] : [bobs]))),
      http.get(`${API}/users/me`, () =>
        HttpResponse.json({
          ...createUser(who === 'admin' ? { id: 1, name: '관리자', aiAvailable: true } : { id: 2, username: 'bob', name: '밥', aiAvailable: true }),
          roles: [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }],
        }),
      ),
      http.post(`${API}/auth/login`, () => HttpResponse.json(createLoginResponse())),
    ],
  })
  expect((await screen.findAllByText('관리자전용 인사평가', undefined, { timeout: PAGE_LOAD_TIMEOUT }))[0]).toBeInTheDocument()

  await logoutViaRail(view)
  who = 'bob'
  await view.user.type(await screen.findByLabelText('아이디'), 'bob')
  await view.user.type(document.querySelector('#password')!, 'Password123')
  await view.user.click(screen.getByRole('button', { name: '로그인' }))
  const rail = await screen.findByTestId('app-rail', undefined, { timeout: PAGE_LOAD_TIMEOUT })
  // 새로고침 없이(SPA) 작업 관리로 — 캐시가 남아 있으면 앞 사용자의 목록이 그려진다.
  await view.user.click(rail.querySelector('a[href="/projects"]')!)
  expect((await screen.findAllByText('밥의 개인 작업'))[0]).toBeInTheDocument()
  expect(screen.queryByText('관리자전용 인사평가')).not.toBeInTheDocument()
})

// 미로그인 상태에서 탭한 알림의 목적지(/push-open 이 보관)는 로그인 뒤 앱 셸이 진입할 때 한 번 소비한다.
test('보관된 알림 대기 목적지는 앱 진입 시 그 주소로 이동하며 소비된다', async () => {
  window.sessionStorage.setItem(PENDING_PUSH_TARGET_KEY, JSON.stringify({ tenantId: null, url: '/calendar' }))
  const view = renderPage('/')
  await waitFor(() => expect(view.location()).toBe('/calendar'), { timeout: PAGE_LOAD_TIMEOUT })
  expect(window.sessionStorage.getItem(PENDING_PUSH_TARGET_KEY)).toBeNull()
})

// 레일 메뉴 순서는 제품 결정(홈→대화→메일→캘린더→작업관리→드라이브→노트→연락처→설정)이다.
test('앱 레일 순서: 홈→대화→메일→캘린더→작업관리→드라이브→노트→연락처→설정', async () => {
  renderPage('/')
  const rail = await screen.findByTestId('app-rail', undefined, { timeout: PAGE_LOAD_TIMEOUT })
  await within(rail).findByTestId('rail-link-/')
  const ids = [...rail.querySelectorAll('[data-testid^="rail-link-"]')].map((el) => el.getAttribute('data-testid'))
  expect(ids).toEqual([
    'rail-link-/',
    'rail-link-/chat',
    'rail-link-/mail',
    'rail-link-/calendar',
    'rail-link-/projects',
    'rail-link-/drive',
    'rail-link-/wiki',
    'rail-link-/contacts',
    'rail-link-/settings/profile',
  ])
})
